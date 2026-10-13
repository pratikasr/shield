// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IRepricer} from "./interfaces/IRepricer.sol";
import {IShieldVault} from "./interfaces/IShieldVault.sol";
import {PremiumMath} from "./libraries/PremiumMath.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";

/// @title Repricer
/// @notice Computes each borrower's premium from Pyth realised volatility and the distance between Aave's
/// health factor and the trigger, and accrues it against the borrower's prepaid balance every block
/// (docs/SPEC.md, Pricing model; ADR-022, ADR-023).
/// @dev Accrual is piecewise constant: the rate set at the last reprice applies to every block since, then
/// a new rate is computed from live state. Nobody can choose a past rate, so calling `reprice` is
/// permissionless. The volatility state for each Pyth feed (header plus 200 observations, two per slot) sits
/// in one 128-slot MIP-8 page at `volSlot(feedId)`.
contract Repricer is IRepricer, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Observations kept per feed (N).
    uint256 public constant WINDOW = 200;
    /// @notice Observations needed before realised volatility replaces the asset's fallback.
    uint256 public constant MIN_SAMPLES = 10;
    uint256 public constant SIGMA_MIN = 0.1e18;
    uint256 public constant SIGMA_MAX = 5e18;

    bytes32 private constant VOL_NAMESPACE = keccak256("shield.repricer.vol.v1");
    uint256 private constant PAGE_MASK = ~uint256(127);

    IPositionRegistry public immutable registry;
    IPool public immutable pool;
    IAaveOracle public immutable oracle;
    IPyth public immutable pyth;
    IERC20 public immutable asset;
    IShieldVault public immutable vault;
    /// @dev 10 ** (18 - asset decimals): converts asset units to the 18-decimal accounting units.
    uint256 public immutable scale;

    /// @notice Block time used to turn an annual premium into a per-block premium (MIP-12: 300 ms).
    uint32 public blockTimeMs = 300;
    /// @notice Charged premium not yet swept, in 18-decimal units: the vault's part and the protocol's (ADR-037).
    /// Sweeps move whole asset units and leave the remainder here. One slot, so a charge writes both with a single
    /// cold store.
    uint128 public pendingToVault;
    uint128 public pendingToTreasury;
    /// @notice The one contract that may top up a borrower's prepaid balance on their behalf: the forwarder
    /// factory, which turns USDC delivered to a borrower's deposit address (by Aurora Intents or a plain transfer)
    /// into premium (ADR-039).
    address public topUpAgent;

    struct Ctx {
        uint256 assetPrice;
        uint256 dMin;
        uint256 protocolShareBps;
    }

    constructor(
        address owner_,
        IPositionRegistry registry_,
        IPool pool_,
        IAaveOracle oracle_,
        IPyth pyth_,
        IERC20 asset_,
        IShieldVault vault_
    ) Ownable(owner_) {
        registry = registry_;
        pool = pool_;
        oracle = oracle_;
        pyth = pyth_;
        asset = asset_;
        vault = vault_;
        uint8 decimals = IERC20Metadata(address(asset_)).decimals();
        if (decimals > 18) revert InvalidParameter();
        scale = 10 ** (18 - decimals);
    }

    // ---------------------------------------------------------------- borrower funds

    /// @notice Add `amount` of the vault asset to the caller's prepaid premium balance.
    function topUp(uint256 amount) external nonReentrant {
        _topUp(msg.sender, amount);
    }

    /// @notice Tops up `borrower`'s prepaid balance with `amount` paid by the caller. Only `topUpAgent` (the
    /// forwarder factory) may call it; the effect is the same as the borrower's own `topUp`.
    function topUpFor(address borrower, uint256 amount) external nonReentrant {
        if (msg.sender != topUpAgent) revert NotTopUpAgent();
        if (borrower == address(0)) revert InvalidParameter();
        _topUp(borrower, amount);
    }

    function _topUp(address borrower, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        registry.creditPrepaid(borrower, SafeCast.toUint128(amount * scale));
        emit ToppedUp(borrower, amount);
    }

    /// @notice Withdraw `amount` of the caller's unused prepaid balance. Premium already due is settled first.
    function withdrawUnused(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IPositionRegistry.Record memory r = registry.record(msg.sender);
        if (r.flags & registry.FLAG_ACTIVE() != 0) {
            _charge(msg.sender, r, true, _ctx());
            r = registry.record(msg.sender);
        }
        uint256 wad = amount * scale;
        if (wad > r.prepaid) revert InsufficientPrepaid(amount, r.prepaid / scale);
        registry.debitPrepaid(msg.sender, SafeCast.toUint128(wad));
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- repricing

    /// @notice Accrue the borrower's premium up to this block and set the next rate.
    /// @param pythUpdate Optional Pyth price update (Hermes); empty uses the on-chain push feeds (ADR-017).
    function reprice(address borrower, bytes[] calldata pythUpdate) external payable nonReentrant {
        _applyPythUpdate(pythUpdate);
        Ctx memory c = _ctx();
        IPositionRegistry.Record memory r = registry.record(borrower);
        if (r.flags & registry.FLAG_ACTIVE() == 0) revert IPositionRegistry.NotActive(borrower);
        _sample(registry.assetConfig(registry.assetAt(r.collateralId)).pythFeedId);
        _charge(borrower, r, true, c);
    }

    /// @notice Reprice many borrowers in one transaction; inactive ones are skipped. Each feed is sampled once.
    function repriceMany(address[] calldata borrowers, bytes[] calldata pythUpdate)
        external
        payable
        nonReentrant
    {
        _applyPythUpdate(pythUpdate);
        Ctx memory c = _ctx();
        uint8 active = registry.FLAG_ACTIVE();
        uint256 sampled = 0; // bitmap of collateral ids already sampled in this call
        for (uint256 i; i < borrowers.length; ++i) {
            IPositionRegistry.Record memory r = registry.record(borrowers[i]);
            if (r.flags & active == 0) continue;
            uint256 bit = 1 << r.collateralId;
            if (sampled & bit == 0) {
                sampled |= bit;
                _sample(registry.assetConfig(registry.assetAt(r.collateralId)).pythFeedId);
            }
            _charge(borrowers[i], r, true, c);
        }
    }

    /// @notice Final accrual before an exit: charges up to this block and stops the rate. Executor only.
    function settleForExit(address borrower) external nonReentrant {
        if (msg.sender != registry.executor()) revert NotExecutor();
        IPositionRegistry.Record memory r = registry.record(borrower);
        _sample(registry.assetConfig(registry.assetAt(r.collateralId)).pythFeedId);
        _charge(borrower, r, false, _ctx());
    }

    /// @notice Final accrual before an opt-out: charges up to this block and stops the rate. Registry only.
    function settleForOptOut(address borrower) external nonReentrant {
        if (msg.sender != address(registry)) revert NotRegistry();
        IPositionRegistry.Record memory r = registry.record(borrower);
        _charge(borrower, r, false, _ctx());
    }

    /// @notice Moves the vault's part of charged premium, in whole asset units, to the vault; the remainder waits.
    /// Anyone may call it, and the vault calls it whenever it moves money. Repricing itself never transfers
    /// tokens, so its gas stays the same block after block.
    /// @return amount Asset units sent to the vault.
    function sweep() external nonReentrant returns (uint256 amount) {
        uint256 pending = pendingToVault;
        amount = pending / scale;
        if (amount == 0) return 0;
        pendingToVault = uint128(pending - amount * scale);
        asset.safeTransfer(address(vault), amount);
        vault.notifyPremium(amount);
        emit PremiumForwarded(amount);
    }

    /// @notice Pays the protocol's part of charged premium, in whole asset units, to the registry's treasury; the
    /// remainder waits. Anyone may call it. Kept apart from `sweep`, which the vault calls before every withdrawal
    /// and exit, so a treasury transfer that fails (a blocklisted address, say) can never stop the vault.
    /// @return amount Asset units sent to the treasury.
    function sweepProtocol() external nonReentrant returns (uint256 amount) {
        uint256 pending = pendingToTreasury;
        amount = pending / scale;
        if (amount == 0) return 0;
        pendingToTreasury = uint128(pending - amount * scale);
        // A share above zero can only be set together with a treasury, so this is never address(0).
        address treasury = registry.treasury();
        asset.safeTransfer(treasury, amount);
        emit ProtocolPremiumPaid(treasury, amount);
    }

    /// @notice Premium charged for the vault and not yet swept, in asset units.
    function pendingPremium() external view returns (uint256) {
        return pendingToVault / scale;
    }

    /// @notice Premium charged for the protocol treasury and not yet swept, in asset units.
    function pendingProtocolPremium() external view returns (uint256) {
        return pendingToTreasury / scale;
    }

    // ---------------------------------------------------------------- owner

    function setTopUpAgent(address agent) external onlyOwner {
        topUpAgent = agent;
        emit TopUpAgentSet(agent);
    }

    function setBlockTimeMs(uint32 blockTimeMs_) external onlyOwner {
        if (blockTimeMs_ < 100 || blockTimeMs_ > 2000) revert InvalidParameter();
        blockTimeMs = blockTimeMs_;
        emit BlockTimeSet(blockTimeMs_);
    }

    // ---------------------------------------------------------------- views

    /// @notice Live quote for a borrower, without changing state: the per-block and annual premium in
    /// 18-decimal vault-asset units, Aave's HF (x 1e18) and the sigma in use (x 1e18).
    function quote(address borrower)
        external
        view
        returns (uint256 premiumPerBlock, uint256 healthFactor, uint256 sigma, uint256 annualPremium)
    {
        IPositionRegistry.Record memory r = registry.record(borrower);
        IPositionRegistry.AssetConfig memory cfg = registry.assetConfig(registry.assetAt(r.collateralId));
        sigma = sigmaOf(cfg.pythFeedId, cfg.sigmaFallback);
        uint256 debtBase;
        (, debtBase,,,, healthFactor) = pool.getUserAccountData(borrower);
        Ctx memory c = _ctx();
        annualPremium =
            PremiumMath.annualPremium(debtBase, healthFactor, r.trigger, c.dMin, cfg.k, sigma, c.assetPrice);
        premiumPerBlock = PremiumMath.perBlock(annualPremium, blockTimeMs);
    }

    /// @notice Quote for a cover that does not exist yet, for the opt-in screen: what `borrower` would pay
    /// with `collateral` and `trigger` (HF x 1e4) at current state.
    function quoteFor(address borrower, address collateral, uint32 trigger)
        external
        view
        returns (uint256 premiumPerBlock, uint256 healthFactor, uint256 sigma, uint256 annualPremium)
    {
        IPositionRegistry.AssetConfig memory cfg = registry.assetConfig(collateral);
        sigma = sigmaOf(cfg.pythFeedId, cfg.sigmaFallback);
        uint256 debtBase;
        (, debtBase,,,, healthFactor) = pool.getUserAccountData(borrower);
        Ctx memory c = _ctx();
        annualPremium =
            PremiumMath.annualPremium(debtBase, healthFactor, trigger, c.dMin, cfg.k, sigma, c.assetPrice);
        premiumPerBlock = PremiumMath.perBlock(annualPremium, blockTimeMs);
    }

    /// @notice Realised annualised volatility x 1e18 for a feed, or `fallbackSigma` with too few observations.
    function sigmaOf(bytes32 feedId, uint64 fallbackSigma) public view returns (uint256 sigma) {
        uint256 base = volSlot(feedId);
        uint256 header = _load(base);
        uint256 count = uint16(header);
        if (count < MIN_SAMPLES) return fallbackSigma;
        uint256 oldestIdx = count == WINDOW ? uint16(header >> 16) : 0;
        (, uint64 oldestTime) = _sampleAt(base, oldestIdx);
        uint64 newestTime = uint64(header >> 160);
        if (newestTime <= oldestTime) return fallbackSigma;
        sigma = PremiumMath.annualisedSigma(uint128(header >> 32), newestTime - oldestTime);
        if (sigma < SIGMA_MIN) sigma = SIGMA_MIN;
        if (sigma > SIGMA_MAX) sigma = SIGMA_MAX;
    }

    /// @notice Volatility window header: observation count, next write index, sum of squared returns
    /// (x 1e18), and the newest and oldest publish times.
    function volState(bytes32 feedId)
        external
        view
        returns (uint16 count, uint16 head, uint128 sumSquares, uint64 newestTime, uint64 oldestTime)
    {
        uint256 base = volSlot(feedId);
        uint256 header = _load(base);
        count = uint16(header);
        head = uint16(header >> 16);
        sumSquares = uint128(header >> 32);
        newestTime = uint64(header >> 160);
        if (count != 0) (, oldestTime) = _sampleAt(base, count == WINDOW ? head : 0);
    }

    /// @notice Page-aligned base slot of a feed's volatility window. The keeper lists it in its access list.
    function volSlot(bytes32 feedId) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(feedId, VOL_NAMESPACE))) & PAGE_MASK;
    }

    // ---------------------------------------------------------------- internals

    function _ctx() private view returns (Ctx memory c) {
        c.assetPrice = oracle.getAssetPrice(address(asset));
        c.dMin = registry.dMin();
        c.protocolShareBps = registry.protocolShareBps();
    }

    /// @dev Charges every block since the last reprice at the higher of the stored rate and the live one, then
    /// stores the live rate (or zero when `setRate` is false, as at exit and opt-out). Billing at the higher
    /// rate means a rate stored from a momentarily improved position cannot discount the next interval
    /// (audit M-3).
    function _charge(address borrower, IPositionRegistry.Record memory r, bool setRate, Ctx memory c)
        private
    {
        uint256 elapsed = block.number - r.lastRepricedBlock;
        uint256 prepaid = r.prepaid;
        uint256 accrued = r.accrued;
        bool lapsed = r.flags & registry.FLAG_LAPSED() != 0;
        (uint256 rate, uint256 hf, uint256 sigma) = _rate(borrower, r, c);
        uint256 charged = 0;
        if (!lapsed && elapsed != 0) {
            uint256 billed = rate > r.premiumPerBlock ? rate : r.premiumPerBlock;
            uint256 due = billed * elapsed;
            charged = due < prepaid ? due : prepaid;
            prepaid -= charged;
            accrued += charged;
            if (prepaid == 0 && due != 0) lapsed = true;
        }

        if (!setRate) rate = 0;
        uint256 hfBps = hf / PremiumMath.BPS_TO_WAD;
        if (hfBps > type(uint32).max) hfBps = type(uint32).max;

        registry.writeRepricerState(
            borrower,
            SafeCast.toUint128(prepaid),
            SafeCast.toUint128(accrued),
            SafeCast.toUint96(rate),
            SafeCast.toUint32(hfBps),
            SafeCast.toUint64(sigma),
            lapsed
        );
        uint256 toTreasury = charged * c.protocolShareBps / 10_000;
        pendingToTreasury += SafeCast.toUint128(toTreasury);
        pendingToVault += SafeCast.toUint128(charged - toTreasury);
        emit Repriced(borrower, charged, rate, hf, sigma, prepaid, lapsed);
    }

    /// @dev Live per-block rate (capped to uint96), Aave HF and sigma for a record.
    function _rate(address borrower, IPositionRegistry.Record memory r, Ctx memory c)
        private
        view
        returns (uint256 rate, uint256 hf, uint256 sigma)
    {
        IPositionRegistry.AssetConfig memory cfg = registry.assetConfig(registry.assetAt(r.collateralId));
        sigma = sigmaOf(cfg.pythFeedId, cfg.sigmaFallback);
        uint256 debtBase;
        (, debtBase,,,, hf) = pool.getUserAccountData(borrower);
        uint256 annual =
            PremiumMath.annualPremium(debtBase, hf, r.trigger, c.dMin, cfg.k, sigma, c.assetPrice);
        rate = PremiumMath.perBlock(annual, blockTimeMs);
        if (rate > type(uint96).max) rate = type(uint96).max;
    }

    function _applyPythUpdate(bytes[] calldata update) private {
        uint256 fee = 0;
        if (update.length != 0) {
            fee = pyth.getUpdateFee(update);
            if (msg.value < fee) revert InsufficientUpdateFee(fee, msg.value);
            pyth.updatePriceFeeds{value: fee}(update);
        }
        uint256 refund = msg.value - fee;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @dev Records the feed's latest Pyth price if it is newer than the newest observation.
    function _sample(bytes32 feedId) private {
        PythStructs.Price memory p = PythStructs.Price(0, 0, 0, 0);
        try pyth.getPriceUnsafe(feedId) returns (PythStructs.Price memory latest) {
            p = latest;
        } catch {
            return;
        }
        if (p.price <= 0 || p.publishTime == 0 || p.publishTime > type(uint64).max) return;
        // Skip observations Pyth itself is unsure of (confidence wider than 1% of price).
        if (uint256(p.conf) * 100 > uint256(uint64(p.price))) return;
        uint256 base = volSlot(feedId);
        uint256 header = _load(base);
        uint256 count = uint16(header);
        uint256 head = uint16(header >> 16);
        uint256 sumSquares = uint128(header >> 32);
        uint64 newest = uint64(header >> 160);
        uint64 time = uint64(p.publishTime);
        // Store prices at a fixed 8-decimal scale so a change of Pyth exponent is not read as a move (L-2).
        uint256 scaled = _toBase(uint64(p.price), p.expo);
        if (scaled == 0 || scaled > type(uint64).max) return;
        uint64 price = uint64(scaled);
        if (count != 0 && time <= newest) return;

        if (count != 0) {
            (uint64 prevPrice,) = _sampleAt(base, (head + WINDOW - 1) % WINDOW);
            sumSquares += PremiumMath.squaredReturn(prevPrice, price);
            if (count == WINDOW) {
                (uint64 oldestPrice,) = _sampleAt(base, head);
                (uint64 secondPrice,) = _sampleAt(base, (head + 1) % WINDOW);
                sumSquares -= PremiumMath.squaredReturn(oldestPrice, secondPrice);
            }
        }
        _writeSample(base, head, price, time);
        head = (head + 1) % WINDOW;
        if (count < WINDOW) ++count;
        if (sumSquares > type(uint128).max) sumSquares = type(uint128).max;
        _store(base, count | (head << 16) | (sumSquares << 32) | (uint256(time) << 160));
        emit PriceSampled(feedId, p.price, time, uint16(count));
    }

    /// @dev Pyth price to an 8-decimal integer.
    function _toBase(uint64 price, int32 expo) private pure returns (uint256) {
        if (expo >= -8) {
            if (expo > 10) return 0;
            return uint256(price) * 10 ** uint32(expo + 8);
        }
        if (expo < -30) return 0;
        return uint256(price) / 10 ** uint32(-8 - expo);
    }

    function _sampleAt(uint256 base, uint256 index) private view returns (uint64 price, uint64 time) {
        uint256 word = _load(base + 1 + (index >> 1));
        uint256 lane = (index & 1) * 128;
        price = uint64(word >> lane);
        time = uint64(word >> (lane + 64));
    }

    function _writeSample(uint256 base, uint256 index, uint64 price, uint64 time) private {
        uint256 slot = base + 1 + (index >> 1);
        uint256 lane = (index & 1) * 128;
        uint256 word = _load(slot);
        word = (word & ~(uint256(type(uint128).max) << lane))
            | ((uint256(price) | (uint256(time) << 64)) << lane);
        _store(slot, word);
    }

    function _load(uint256 slot) private view returns (uint256 v) {
        assembly ("memory-safe") {
            v := sload(slot)
        }
    }

    function _store(uint256 slot, uint256 v) private {
        assembly ("memory-safe") {
            sstore(slot, v)
        }
    }
}

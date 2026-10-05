// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IRepricer} from "./interfaces/IRepricer.sol";
import {IShieldVault} from "./interfaces/IShieldVault.sol";
import {ISwapper} from "./interfaces/ISwapper.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "aave-v3-origin/contracts/interfaces/IPoolAddressesProvider.sol";
import {
    IFlashLoanSimpleReceiver
} from "aave-v3-origin/contracts/misc/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";

/// @title Executor
/// @notice The exit. When a covered borrower's Aave HF is at or below their trigger, anyone may call `exit`:
/// the vault (or an Aave flash loan for the part the vault cannot fund) repays enough of the borrower's
/// debt to restore HF to trigger + buffer, the borrower's aTokens worth (1 + discount) x the repaid value
/// move to the vault, and the call reverts unless HF ends above 1.0 and above where it started (ADR-021).
/// @dev The borrower approves this contract on their collateral aToken at opt-in. The only place that
/// allowance is used is `_repayAndSeize`, after a successful repay in the same transaction.
contract Executor is IFlashLoanSimpleReceiver, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS_TO_WAD = 1e14;

    /// @notice Why an exit can or cannot run now. `previewExit` returns it; `exit` reverts on anything but Ready.
    enum Status {
        Ready,
        NotActive,
        CoverLapsed,
        AboveTrigger,
        EModeUnsupported,
        DiscountAboveMax,
        NothingToRepay,
        AllowanceTooLow,
        PythStale,
        OracleDeviation,
        TargetUnreachable,
        CoverWarmingUp
    }

    /// @notice A computed exit. Amounts are in token units; prices are Aave base currency (USD x 1e8).
    struct Plan {
        address borrower;
        address collateral;
        address aToken;
        uint256 repayAmount;
        uint256 seizeAmount;
        uint256 healthFactor;
        uint256 discountBps;
        uint256 liquidationBonusBps;
        uint256 assetPrice;
        uint256 collateralPrice;
        uint256 collateralUnit;
    }

    event Exited(
        address indexed borrower,
        address indexed collateral,
        uint256 repaid,
        uint256 seized,
        uint256 savedVsAave,
        uint256 healthFactorBefore,
        uint256 healthFactorAfter,
        uint256 flashLoanAmount
    );
    event SwapperSet(address swapper);
    event ExitParamsSet(uint16 maxSwapSlippageBps, uint16 maxOracleDeviationBps, uint32 exitMaxPriceAge);

    event MinCoverSecondsSet(uint32 minCoverSeconds);

    error ExitBlocked(Status status);
    error HealthNotImproved(uint256 before, uint256 afterExit);
    error HealthAtOrBelowOne(uint256 afterExit);
    error InvalidFlashLoan();
    error NoSwapper();
    error InsufficientUpdateFee(uint256 fee, uint256 sent);
    error RefundFailed();
    error InvalidParameter();
    error SwapShortfall(uint256 received, uint256 needed);
    error VaultWouldLose(uint256 returned, uint256 contributed);

    IPositionRegistry public immutable registry;
    IRepricer public immutable repricer;
    IShieldVault public immutable vault;
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IPool public immutable POOL;
    IAaveOracle public immutable oracle;
    IPyth public immutable pyth;
    IERC20 public immutable asset;
    uint256 private immutable assetUnit;

    ISwapper public swapper;
    /// @notice Most the flash-loan swap may lose against the Aave oracle price (ADR-018).
    uint16 public maxSwapSlippageBps = 300;
    /// @notice Most Aave's collateral price may differ from Pyth's before an exit is refused.
    uint16 public maxOracleDeviationBps = 200;
    /// @notice Oldest Pyth price an exit accepts, in seconds (the push-feed heartbeat; ADR-017).
    uint32 public exitMaxPriceAge = 3600;
    /// @notice How long cover must have been held, since opt-in, a restore from lapse or a trigger raise, before
    /// it can exit. Stops cover being bought at the moment it is needed (audit H-1).
    uint32 public minCoverSeconds = 900;

    bool private transient _inFlash;
    uint256 private transient _flashRepaid;
    uint256 private transient _flashSeized;

    constructor(
        address owner_,
        IPositionRegistry registry_,
        IRepricer repricer_,
        IShieldVault vault_,
        IPoolAddressesProvider addressesProvider_,
        IPyth pyth_,
        IERC20 asset_
    ) Ownable(owner_) {
        registry = registry_;
        repricer = repricer_;
        vault = vault_;
        ADDRESSES_PROVIDER = addressesProvider_;
        POOL = IPool(addressesProvider_.getPool());
        oracle = IAaveOracle(addressesProvider_.getPriceOracle());
        pyth = pyth_;
        asset = asset_;
        assetUnit = 10 ** IERC20Metadata(address(asset_)).decimals();
    }

    // ---------------------------------------------------------------- exit

    /// @notice Exit `borrower`'s covered position. Permissionless: the conditions, not the caller, gate it.
    /// @param pythUpdate Optional Pyth price update; empty relies on the on-chain push feed (ADR-017).
    /// @return repaid Debt repaid on the borrower's behalf, in vault-asset units.
    /// @return seized Collateral aTokens taken by the vault side, in collateral units.
    function exit(address borrower, bytes[] calldata pythUpdate)
        external
        payable
        nonReentrant
        returns (uint256 repaid, uint256 seized)
    {
        _applyPythUpdate(pythUpdate);

        IPositionRegistry.Record memory r = registry.record(borrower);
        if (r.flags & registry.FLAG_ACTIVE() == 0) revert ExitBlocked(Status.NotActive);
        if (r.flags & registry.FLAG_LAPSED() != 0) revert ExitBlocked(Status.CoverLapsed);
        repricer.settleForExit(borrower);
        // Settlement charges the blocks since the last reprice; if that empties the prepaid balance the cover
        // lapses, and an unpaid cover does not exit.
        r = registry.record(borrower);
        if (r.flags & registry.FLAG_LAPSED() != 0) revert ExitBlocked(Status.CoverLapsed);

        (Status status, Plan memory p) = _plan(borrower, r);
        if (status != Status.Ready) revert ExitBlocked(status);

        uint256 idle = vault.availableLiquidity();
        uint256 fromVault = idle >= p.repayAmount ? p.repayAmount : idle;
        if (fromVault != 0) vault.fundExit(fromVault);
        uint256 flashAmount = p.repayAmount - fromVault;

        if (flashAmount == 0) {
            (repaid, seized) = _repayAndSeize(p, address(vault));
            uint256 leftover = asset.balanceOf(address(this));
            if (leftover != 0) asset.safeTransfer(address(vault), leftover);
            vault.recordExit(p.collateral, seized, repaid, _valueInAsset(p, seized), false);
        } else {
            if (address(swapper) == address(0)) revert NoSwapper();
            _inFlash = true;
            POOL.flashLoanSimple(address(this), address(asset), flashAmount, abi.encode(p, fromVault), 0);
            _inFlash = false;
            repaid = _flashRepaid;
            seized = _flashSeized;
        }

        (,,,,, uint256 hfAfter) = POOL.getUserAccountData(borrower);
        if (hfAfter <= WAD) revert HealthAtOrBelowOne(hfAfter);
        if (hfAfter <= p.healthFactor) revert HealthNotImproved(p.healthFactor, hfAfter);

        registry.markExited(borrower);
        uint256 penaltyBps = p.liquidationBonusBps > BPS ? p.liquidationBonusBps - BPS : 0;
        uint256 saved = penaltyBps > p.discountBps ? Math.mulDiv(repaid, penaltyBps - p.discountBps, BPS) : 0;
        emit Exited(borrower, p.collateral, repaid, seized, saved, p.healthFactor, hfAfter, flashAmount);
    }

    /// @inheritdoc IFlashLoanSimpleReceiver
    /// @dev Flash-loan leg of `exit`: repay, seize to this contract, sell just enough collateral to close the
    /// loan within the slippage bound, hand the rest to the vault.
    function executeOperation(
        address,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != address(POOL) || initiator != address(this) || !_inFlash) {
            revert InvalidFlashLoan();
        }
        (Plan memory p, uint256 fromVault) = abi.decode(params, (Plan, uint256));

        (uint256 repaid, uint256 seized) = _repayAndSeize(p, address(this));
        uint256 owed = amount + premium;
        uint256 resupplied = _sellForShortfall(p, seized, owed);
        uint256 aLeft = IERC20(p.aToken).balanceOf(address(this));
        if (aLeft != 0) IERC20(p.aToken).safeTransfer(address(vault), aLeft);
        uint256 bal = asset.balanceOf(address(this));
        if (bal > owed) asset.safeTransfer(address(vault), bal - owed);
        asset.forceApprove(address(POOL), owed);

        uint256 kept = aLeft + resupplied;
        uint256 keptValue = _valueInAsset(p, kept);
        // The swap and the flash premium come out of the vault's share. Whatever the market fills, the vault
        // must end with at least the USDC it put in, valued at Aave's oracle (audit F2).
        uint256 returned = keptValue + (bal > owed ? bal - owed : 0);
        if (returned < fromVault) revert VaultWouldLose(returned, fromVault);
        vault.recordExit(p.collateral, kept, fromVault, keptValue, true);
        _flashRepaid = repaid;
        _flashSeized = seized;
        return true;
    }

    // ---------------------------------------------------------------- views

    /// @notice What an exit would do now: status, repay amount (vault asset), seize amount (collateral)
    /// and the borrower's current HF (x 1e18). Used by the keeper before it spends gas, and by the UI.
    function previewExit(address borrower)
        external
        view
        returns (Status status, uint256 repayAmount, uint256 seizeAmount, uint256 healthFactor)
    {
        IPositionRegistry.Record memory r = registry.record(borrower);
        if (r.flags & registry.FLAG_ACTIVE() == 0) return (Status.NotActive, 0, 0, 0);
        if (r.flags & registry.FLAG_LAPSED() != 0) return (Status.CoverLapsed, 0, 0, 0);
        Plan memory p;
        (status, p) = _plan(borrower, r);
        return (status, p.repayAmount, p.seizeAmount, p.healthFactor);
    }

    // ---------------------------------------------------------------- owner

    function setSwapper(ISwapper swapper_) external onlyOwner {
        swapper = swapper_;
        emit SwapperSet(address(swapper_));
    }

    function setMinCoverSeconds(uint32 minCoverSeconds_) external onlyOwner {
        if (minCoverSeconds_ > 7 days) revert InvalidParameter();
        minCoverSeconds = minCoverSeconds_;
        emit MinCoverSecondsSet(minCoverSeconds_);
    }

    function setExitParams(uint16 maxSwapSlippageBps_, uint16 maxOracleDeviationBps_, uint32 exitMaxPriceAge_)
        external
        onlyOwner
    {
        if (maxSwapSlippageBps_ > 1000 || maxOracleDeviationBps_ == 0 || maxOracleDeviationBps_ > 2000) {
            revert InvalidParameter();
        }
        if (exitMaxPriceAge_ < 10 || exitMaxPriceAge_ > 86_400) revert InvalidParameter();
        maxSwapSlippageBps = maxSwapSlippageBps_;
        maxOracleDeviationBps = maxOracleDeviationBps_;
        exitMaxPriceAge = exitMaxPriceAge_;
        emit ExitParamsSet(maxSwapSlippageBps_, maxOracleDeviationBps_, exitMaxPriceAge_);
    }

    // ---------------------------------------------------------------- internals

    /// @dev Sizes the exit from live Aave state (ADR-021) and runs every pre-check that does not need state
    /// changes. Never reverts on a failed check; returns the reason instead.
    function _plan(address borrower, IPositionRegistry.Record memory r)
        private
        view
        returns (Status, Plan memory p)
    {
        p.borrower = borrower;
        uint256 debtBase;
        (, debtBase,,,, p.healthFactor) = POOL.getUserAccountData(borrower);
        if (block.timestamp < uint256(r.optedInAt) + minCoverSeconds) return (Status.CoverWarmingUp, p);
        if (p.healthFactor > uint256(r.trigger) * BPS_TO_WAD) return (Status.AboveTrigger, p);
        if (POOL.getUserEMode(borrower) != 0) return (Status.EModeUnsupported, p);
        p.discountBps = registry.exitDiscountBps();
        if (p.discountBps > r.maxDiscountBps) return (Status.DiscountAboveMax, p);

        p.collateral = registry.assetAt(r.collateralId);
        p.aToken = POOL.getReserveAToken(p.collateral);
        uint256 cfg = POOL.getConfiguration(p.collateral).data;
        uint256 lt = (cfg >> 16) & 0xffff;
        p.liquidationBonusBps = (cfg >> 32) & 0xffff;
        p.collateralUnit = 10 ** ((cfg >> 48) & 0xff);
        p.assetPrice = oracle.getAssetPrice(address(asset));
        p.collateralPrice = oracle.getAssetPrice(p.collateral);

        // r = D * (H_t - HF) / (H_t - (1 + delta) * LT_c), all in base currency and HF x 1e18.
        uint256 target = (uint256(r.trigger) + registry.exitHfBuffer()) * BPS_TO_WAD;
        uint256 lossPerUnit = (BPS + p.discountBps) * lt * 1e10;
        if (target <= lossPerUnit || target <= p.healthFactor) return (Status.TargetUnreachable, p);
        uint256 repayBase = Math.mulDiv(debtBase, target - p.healthFactor, target - lossPerUnit);
        p.repayAmount = Math.mulDiv(repayBase, assetUnit, p.assetPrice);
        uint256 debt = IERC20(POOL.getReserveVariableDebtToken(address(asset))).balanceOf(borrower);
        if (p.repayAmount > debt) p.repayAmount = debt;
        p.seizeAmount = _seizeFor(p, p.repayAmount);
        uint256 available = IERC20(p.aToken).balanceOf(borrower);
        if (p.seizeAmount > available) {
            p.seizeAmount = available;
            uint256 valueBase =
                Math.mulDiv(available, p.collateralPrice * BPS, p.collateralUnit * (BPS + p.discountBps));
            p.repayAmount = Math.mulDiv(valueBase, assetUnit, p.assetPrice);
            p.seizeAmount = _seizeFor(p, p.repayAmount);
        }
        if (p.repayAmount == 0 || p.seizeAmount == 0) return (Status.NothingToRepay, p);
        if (IERC20(p.aToken).allowance(borrower, address(this)) < p.seizeAmount) {
            return (Status.AllowanceTooLow, p);
        }

        return (_checkPyth(r.collateralId, p.collateralPrice), p);
    }

    /// @dev Pyth must be fresh and agree with Aave's collateral price within maxOracleDeviationBps.
    function _checkPyth(uint8 collateralId, uint256 aavePrice) private view returns (Status) {
        bytes32 feedId = registry.assetConfig(registry.assetAt(collateralId)).pythFeedId;
        PythStructs.Price memory pp = PythStructs.Price(0, 0, 0, 0);
        try pyth.getPriceUnsafe(feedId) returns (PythStructs.Price memory price) {
            pp = price;
        } catch {
            return Status.PythStale;
        }
        if (pp.price <= 0 || pp.publishTime + exitMaxPriceAge < block.timestamp) return Status.PythStale;
        // A Pyth price whose confidence interval is wider than the deviation bound cannot vouch for Aave's.
        if (uint256(pp.conf) * BPS > uint256(uint64(pp.price)) * maxOracleDeviationBps) {
            return Status.OracleDeviation;
        }
        uint256 pythPrice = _toBase(uint64(pp.price), pp.expo);
        uint256 diff = pythPrice > aavePrice ? pythPrice - aavePrice : aavePrice - pythPrice;
        if (diff * BPS > aavePrice * maxOracleDeviationBps) return Status.OracleDeviation;
        return Status.Ready;
    }

    /// @dev Sells just enough seized collateral to cover what the flash loan still needs, bounded by the oracle
    /// price plus maxSwapSlippageBps and by the amount seized; the unsold remainder is re-supplied to Aave for
    /// the vault. The flash premium and the swap cost come out of the LPs' discount (ADR-018).
    /// @return resupplied Collateral re-supplied on the vault's behalf.
    function _sellForShortfall(Plan memory p, uint256 seized, uint256 owed)
        private
        returns (uint256 resupplied)
    {
        uint256 onHand = asset.balanceOf(address(this));
        if (owed <= onHand) return 0;
        uint256 shortfall = owed - onHand;
        uint256 shortfallBase = Math.mulDiv(shortfall, p.assetPrice, assetUnit, Math.Rounding.Ceil);
        uint256 maxIn = Math.mulDiv(
            shortfallBase,
            (BPS + maxSwapSlippageBps) * p.collateralUnit,
            BPS * p.collateralPrice,
            Math.Rounding.Ceil
        );
        // Never sell more than was seized; the swap then must clear an even tighter price or revert.
        if (maxIn > seized) maxIn = seized;
        uint256 withdrawn = POOL.withdraw(p.collateral, maxIn, address(this));
        IERC20(p.collateral).forceApprove(address(swapper), withdrawn);
        swapper.swapExactOut(p.collateral, address(asset), shortfall, withdrawn, address(this));
        IERC20(p.collateral).forceApprove(address(swapper), 0);
        // Trust balances, not the swapper's return value (audit F1): the USDC must have arrived, and whatever
        // collateral is still here goes back to Aave for the vault.
        uint256 received = asset.balanceOf(address(this)) - onHand;
        if (received < shortfall) revert SwapShortfall(received, shortfall);
        resupplied = IERC20(p.collateral).balanceOf(address(this));
        if (resupplied != 0) {
            IERC20(p.collateral).forceApprove(address(POOL), resupplied);
            POOL.supply(p.collateral, resupplied, address(vault), 0);
        }
    }

    /// @dev Repays `p.repayAmount` on the borrower's behalf, then moves the matching aTokens to `recipient`.
    function _repayAndSeize(Plan memory p, address recipient)
        private
        returns (uint256 repaid, uint256 seized)
    {
        asset.forceApprove(address(POOL), p.repayAmount);
        repaid = POOL.repay(address(asset), p.repayAmount, 2, p.borrower);
        asset.forceApprove(address(POOL), 0);
        seized = repaid == p.repayAmount ? p.seizeAmount : _seizeFor(p, repaid);
        IERC20(p.aToken).safeTransferFrom(p.borrower, recipient, seized);
    }

    /// @dev Collateral worth (1 + discount) x `repayAmount` at Aave's oracle.
    function _seizeFor(Plan memory p, uint256 repayAmount) private view returns (uint256) {
        uint256 valueBase = Math.mulDiv(repayAmount, p.assetPrice, assetUnit);
        return Math.mulDiv(valueBase, (BPS + p.discountBps) * p.collateralUnit, BPS * p.collateralPrice);
    }

    function _valueInAsset(Plan memory p, uint256 collateralAmount) private view returns (uint256) {
        uint256 valueBase = Math.mulDiv(collateralAmount, p.collateralPrice, p.collateralUnit);
        return Math.mulDiv(valueBase, assetUnit, p.assetPrice);
    }

    /// @dev Pyth price to Aave base currency (x 1e8).
    function _toBase(uint64 price, int32 expo) private pure returns (uint256) {
        if (expo >= -8) return uint256(price) * 10 ** uint32(expo + 8);
        return uint256(price) / 10 ** uint32(-8 - expo);
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
}

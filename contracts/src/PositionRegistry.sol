// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IRepricer} from "./interfaces/IRepricer.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title PositionRegistry
/// @notice One packed record per opted-in borrower. Each record starts at a page-aligned base slot, so the
/// whole record sits inside one 128-slot MIP-8 storage page: the first access to it costs 8,100 gas and every
/// further slot 100, and one EIP-2930 access-list key warms all of it (ADR-008).
/// @dev Record layout, three slots from `recordSlot(borrower)`:
///   slot 0: trigger u32 | maxDiscountBps u16 << 32 | flags u8 << 48 | collateralId u8 << 56
///           | lastRepricedBlock u64 << 64 | listIndex u32 << 128 | optedInAt u64 << 160
///   slot 1: prepaid u128 | accrued u128 << 128
///   slot 2: premiumPerBlock u96 | healthFactorBps u32 << 96 | sigma u64 << 128
/// HF values are x 1e4; money values are 18-decimal units of the vault asset; sigma is x 1e18.
contract PositionRegistry is IPositionRegistry, Ownable2Step {
    uint8 public constant FLAG_ACTIVE = 1;
    uint8 public constant FLAG_LAPSED = 2;
    uint8 public constant FLAG_EXITED = 4;

    /// @notice Trigger bounds, HF x 1e4: 1.01 to 2.00.
    uint32 public constant MIN_TRIGGER = 10_100;
    uint32 public constant MAX_TRIGGER = 20_000;
    /// @notice The highest exit discount a borrower may accept, and the highest the owner may set.
    uint16 public constant MAX_DISCOUNT_CEILING_BPS = 500;
    /// @notice Prepaid balance needed to opt in: 1 USDC, in 18-decimal units. Keeps dust records out of the
    /// keeper's batch (audit M-4).
    uint256 public constant MIN_PREPAY = 1e18;
    /// @notice Upper bound on an asset's pricing constant k: ten times the calibrated 0.00125 (audit L-3).
    uint64 public constant MAX_K = 0.0125e18;
    /// @notice Bounds on an asset's fallback volatility, the same clamp the Repricer applies to measured sigma.
    uint64 public constant MIN_SIGMA_FALLBACK = 0.1e18;
    uint64 public constant MAX_SIGMA_FALLBACK = 5e18;

    bytes32 private constant RECORD_NAMESPACE = keccak256("shield.registry.record.v1");
    uint256 private constant PAGE_MASK = ~uint256(127);

    address public repricer;
    address public executor;

    /// @notice Discount on seized collateral at exit, in bps. Must not exceed a borrower's maxDiscountBps.
    uint16 public exitDiscountBps = 100;
    /// @notice An exit restores HF to trigger + exitHfBuffer (HF x 1e4).
    uint32 public exitHfBuffer = 600;
    /// @notice Floor on the HF distance in the premium formula (HF x 1e4).
    uint32 public dMin = 100;

    mapping(address collateral => AssetConfig) private _assetConfig;
    address[] private _assets;
    address[] private _active;

    modifier onlyRepricer() {
        if (msg.sender != repricer) revert NotRepricer();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(address owner_) Ownable(owner_) {}

    // ---------------------------------------------------------------- borrower actions

    /// @notice Opt in to cover for the caller's Aave position, seizing `collateral` at exit.
    /// @param collateral Underlying Aave reserve the vault takes at exit (for example WETH).
    /// @param trigger Exit trigger, HF x 1e4, between 1.01 and 2.00.
    /// @param maxDiscountBps Highest exit discount the caller accepts; at least the current exitDiscountBps.
    function optIn(address collateral, uint32 trigger, uint16 maxDiscountBps) external {
        AssetConfig memory cfg = _assetConfig[collateral];
        if (!cfg.enabled) revert AssetNotEnabled(collateral);
        _checkTrigger(trigger);
        _checkMaxDiscount(maxDiscountBps);

        uint256 base = recordSlot(msg.sender);
        uint256 s0 = _load(base);
        if (_flags(s0) & FLAG_ACTIVE != 0) revert AlreadyActive(msg.sender);

        uint256 s1 = _load(base + 1);
        if (uint128(s1) < MIN_PREPAY) revert PrepayTooLow(uint128(s1), MIN_PREPAY);
        _active.push(msg.sender);
        uint256 listIndex = _active.length;
        uint8 flags = FLAG_ACTIVE;

        s0 = uint256(trigger) | (uint256(maxDiscountBps) << 32) | (uint256(flags) << 48)
            | (uint256(cfg.id) << 56) | (uint256(block.number) << 64) | (listIndex << 128)
            | (uint256(block.timestamp) << 160);
        _store(base, s0);
        // Fresh rate: the first reprice prices the cover from live state.
        _store(base + 2, 0);

        emit OptedIn(msg.sender, collateral, trigger, maxDiscountBps);
        if (flags & FLAG_LAPSED != 0) emit CoverLapsed(msg.sender);
    }

    /// @notice Move the caller's exit trigger. Raising it restarts the cover's waiting period, so a trigger
    /// cannot be lifted over the current HF to exit at once (audit H-1).
    function setTrigger(uint32 trigger) external {
        _checkTrigger(trigger);
        uint256 base = recordSlot(msg.sender);
        uint256 s0 = _load(base);
        if (_flags(s0) & FLAG_ACTIVE == 0) revert NotActive(msg.sender);
        if (trigger > uint32(s0)) s0 = _withCoverStart(s0);
        _store(base, (s0 & ~uint256(0xffffffff)) | trigger);
        emit TriggerSet(msg.sender, trigger);
    }

    /// @notice Change the caller's discount ceiling.
    function setMaxDiscount(uint16 maxDiscountBps) external {
        _checkMaxDiscount(maxDiscountBps);
        uint256 base = recordSlot(msg.sender);
        uint256 s0 = _load(base);
        if (_flags(s0) & FLAG_ACTIVE == 0) revert NotActive(msg.sender);
        _store(base, (s0 & ~(uint256(0xffff) << 32)) | (uint256(maxDiscountBps) << 32));
        emit MaxDiscountSet(msg.sender, maxDiscountBps);
    }

    /// @notice End cover. The blocks since the last reprice are charged first (audit M-2); the rest of the
    /// prepaid balance stays withdrawable from the Repricer.
    function optOut() external {
        uint256 base = recordSlot(msg.sender);
        if (_flags(_load(base)) & FLAG_ACTIVE == 0) revert NotActive(msg.sender);
        if (repricer != address(0)) IRepricer(repricer).settleForOptOut(msg.sender);
        uint256 s0 = _load(base);
        _close(msg.sender, base, s0, 0);
        emit OptedOut(msg.sender);
    }

    // ---------------------------------------------------------------- module writes

    /// @inheritdoc IPositionRegistry
    function writeRepricerState(
        address borrower,
        uint128 prepaid,
        uint128 accrued,
        uint96 premiumPerBlock,
        uint32 healthFactorBps,
        uint64 sigma,
        bool lapsed
    ) external onlyRepricer {
        uint256 base = recordSlot(borrower);
        uint256 s0 = _load(base);
        uint8 flags = _flags(s0);
        bool wasLapsed = flags & FLAG_LAPSED != 0;
        flags = lapsed ? flags | FLAG_LAPSED : flags & ~FLAG_LAPSED;
        s0 = (s0 & ~((uint256(0xff) << 48) | (uint256(type(uint64).max) << 64))) | (uint256(flags) << 48)
            | (uint256(block.number) << 64);
        _store(base, s0);
        _store(base + 1, uint256(prepaid) | (uint256(accrued) << 128));
        _store(
            base + 2, uint256(premiumPerBlock) | (uint256(healthFactorBps) << 96) | (uint256(sigma) << 128)
        );
        if (lapsed && !wasLapsed) emit CoverLapsed(borrower);
        if (!lapsed && wasLapsed) emit CoverRestored(borrower);
    }

    /// @inheritdoc IPositionRegistry
    function creditPrepaid(address borrower, uint128 amount) external onlyRepricer {
        uint256 base = recordSlot(borrower);
        uint256 s1 = _load(base + 1);
        _store(base + 1, (s1 & ~uint256(type(uint128).max)) | (uint128(s1) + amount));
        uint256 s0 = _load(base);
        uint8 flags = _flags(s0);
        if (flags & FLAG_LAPSED != 0 && amount != 0) {
            // Restart the accrual clock so the unprotected blocks are never charged, and restart the waiting
            // period so cover cannot be bought back at the moment it is needed (audit H-1).
            s0 = (s0 & ~(uint256(type(uint64).max) << 64)) | (uint256(block.number) << 64);
            if (flags & FLAG_ACTIVE != 0) s0 = _withCoverStart(s0);
            _store(base, _withFlags(s0, flags & ~FLAG_LAPSED));
            if (flags & FLAG_ACTIVE != 0) emit CoverRestored(borrower);
        }
    }

    /// @inheritdoc IPositionRegistry
    function debitPrepaid(address borrower, uint128 amount) external onlyRepricer {
        uint256 base = recordSlot(borrower);
        uint256 s1 = _load(base + 1);
        uint128 prepaid = uint128(s1) - amount;
        _store(base + 1, (s1 & ~uint256(type(uint128).max)) | prepaid);
        if (prepaid == 0) {
            uint256 s0 = _load(base);
            uint8 flags = _flags(s0);
            if (flags & FLAG_LAPSED == 0) {
                _store(base, _withFlags(s0, flags | FLAG_LAPSED));
                if (flags & FLAG_ACTIVE != 0) emit CoverLapsed(borrower);
            }
        }
    }

    /// @inheritdoc IPositionRegistry
    function markExited(address borrower) external onlyExecutor {
        uint256 base = recordSlot(borrower);
        uint256 s0 = _load(base);
        if (_flags(s0) & FLAG_ACTIVE == 0) revert NotActive(borrower);
        _close(borrower, base, s0, FLAG_EXITED);
    }

    // ---------------------------------------------------------------- owner

    /// @notice Wire the Repricer and Executor once, after all four contracts are deployed.
    function setModules(address repricer_, address executor_) external onlyOwner {
        if (repricer != address(0) || executor != address(0)) revert ModulesAlreadySet();
        if (repricer_ == address(0) || executor_ == address(0)) revert InvalidParameter();
        repricer = repricer_;
        executor = executor_;
        emit ModulesSet(repricer_, executor_);
    }

    /// @notice List or update a collateral asset. `k` and `sigmaFallback` are x 1e18.
    function setAsset(address collateral, bytes32 pythFeedId, uint64 k, uint64 sigmaFallback, bool enabled)
        external
        onlyOwner
    {
        if (collateral == address(0) || pythFeedId == bytes32(0) || k == 0 || k > MAX_K) {
            revert InvalidParameter();
        }
        if (sigmaFallback < MIN_SIGMA_FALLBACK || sigmaFallback > MAX_SIGMA_FALLBACK) {
            revert InvalidParameter();
        }
        AssetConfig storage cfg = _assetConfig[collateral];
        if (cfg.pythFeedId == bytes32(0)) {
            if (_assets.length > type(uint8).max) revert InvalidParameter();
            cfg.id = uint8(_assets.length);
            _assets.push(collateral);
        }
        cfg.enabled = enabled;
        cfg.pythFeedId = pythFeedId;
        cfg.k = k;
        cfg.sigmaFallback = sigmaFallback;
        emit AssetConfigured(collateral, cfg.id, pythFeedId, k, sigmaFallback, enabled);
    }

    /// @notice Exit discount (bps), post-exit HF buffer and premium distance floor (both HF x 1e4).
    function setExitParams(uint16 exitDiscountBps_, uint32 exitHfBuffer_, uint32 dMin_) external onlyOwner {
        if (exitDiscountBps_ == 0 || exitDiscountBps_ > MAX_DISCOUNT_CEILING_BPS) revert InvalidParameter();
        if (exitHfBuffer_ < 100 || exitHfBuffer_ > 5000) revert InvalidParameter();
        if (dMin_ < 10 || dMin_ > 2000) revert InvalidParameter();
        exitDiscountBps = exitDiscountBps_;
        exitHfBuffer = exitHfBuffer_;
        dMin = dMin_;
        emit ExitParamsSet(exitDiscountBps_, exitHfBuffer_, dMin_);
    }

    // ---------------------------------------------------------------- views

    /// @notice Page-aligned base slot of a borrower's record. The keeper lists it in its access list.
    function recordSlot(address borrower) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(borrower, RECORD_NAMESPACE))) & PAGE_MASK;
    }

    /// @inheritdoc IPositionRegistry
    function record(address borrower) external view returns (Record memory r) {
        uint256 base = recordSlot(borrower);
        uint256 s0 = _load(base);
        uint256 s1 = _load(base + 1);
        uint256 s2 = _load(base + 2);
        r.trigger = uint32(s0);
        r.maxDiscountBps = uint16(s0 >> 32);
        r.flags = uint8(s0 >> 48);
        r.collateralId = uint8(s0 >> 56);
        r.lastRepricedBlock = uint64(s0 >> 64);
        r.listIndex = uint32(s0 >> 128);
        r.optedInAt = uint64(s0 >> 160);
        r.prepaid = uint128(s1);
        r.accrued = uint128(s1 >> 128);
        r.premiumPerBlock = uint96(s2);
        r.healthFactorBps = uint32(s2 >> 96);
        r.sigma = uint64(s2 >> 128);
    }

    /// @notice The collateral asset a borrower's cover seizes.
    function collateralOf(address borrower) external view returns (address) {
        return _assets[uint8(_load(recordSlot(borrower)) >> 56)];
    }

    function assetConfig(address collateral) external view returns (AssetConfig memory) {
        return _assetConfig[collateral];
    }

    function assetAt(uint8 id) external view returns (address) {
        return _assets[id];
    }

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function activeCount() external view returns (uint256) {
        return _active.length;
    }

    /// @notice A page of active borrowers, for the keeper's per-block scan.
    function activeBorrowers(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 n = _active.length;
        if (offset >= n) return new address[](0);
        uint256 end = limit > n - offset ? n : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            out[i - offset] = _active[i];
        }
    }

    // ---------------------------------------------------------------- internals

    /// @dev Stamps the start of cover (the opted-in time field) with now; the Executor's waiting period counts
    /// from it.
    function _withCoverStart(uint256 s0) private view returns (uint256) {
        return (s0 & ~(uint256(type(uint64).max) << 160)) | (uint256(block.timestamp) << 160);
    }

    function _close(address borrower, uint256 base, uint256 s0, uint8 extraFlag) private {
        uint256 listIndex = uint32(s0 >> 128);
        uint256 last = _active.length;
        if (listIndex != last) {
            address moved = _active[last - 1];
            _active[listIndex - 1] = moved;
            uint256 movedBase = recordSlot(moved);
            uint256 m0 = _load(movedBase);
            _store(movedBase, (m0 & ~(uint256(0xffffffff) << 128)) | (listIndex << 128));
        }
        _active.pop();
        uint8 flags = (_flags(s0) & ~FLAG_ACTIVE) | extraFlag;
        s0 = (_withFlags(s0, flags) & ~(uint256(0xffffffff) << 128));
        _store(base, s0);
        // Clear the live rate; health factor and sigma stay as the last observation.
        uint256 s2 = _load(base + 2);
        _store(base + 2, s2 & ~uint256(type(uint96).max));
        emit RecordClosed(borrower);
    }

    function _checkTrigger(uint32 trigger) private pure {
        if (trigger < MIN_TRIGGER || trigger > MAX_TRIGGER) revert TriggerOutOfRange(trigger);
    }

    function _checkMaxDiscount(uint16 maxDiscountBps) private view {
        uint16 minimum = exitDiscountBps;
        if (maxDiscountBps < minimum || maxDiscountBps > MAX_DISCOUNT_CEILING_BPS) {
            revert MaxDiscountOutOfRange(maxDiscountBps, minimum);
        }
    }

    function _flags(uint256 s0) private pure returns (uint8) {
        return uint8(s0 >> 48);
    }

    function _withFlags(uint256 s0, uint8 flags) private pure returns (uint256) {
        return (s0 & ~(uint256(0xff) << 48)) | (uint256(flags) << 48);
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

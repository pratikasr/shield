// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title IPositionRegistry
/// @notice Records of opted-in borrowers and the protocol parameters the Repricer and Executor read.
interface IPositionRegistry {
    /// @notice One borrower's cover. Units: HF values are x 1e4, money values are 18-decimal units of the
    /// vault asset (1e18 = 1 USDC), sigma is annualised volatility x 1e18.
    struct Record {
        uint32 trigger;
        uint16 maxDiscountBps;
        uint8 flags;
        uint8 collateralId;
        uint64 lastRepricedBlock;
        uint32 listIndex;
        uint64 optedInAt;
        uint128 prepaid;
        uint128 accrued;
        uint96 premiumPerBlock;
        uint32 healthFactorBps;
        uint64 sigma;
    }

    /// @notice Pricing and oracle settings for one collateral asset.
    struct AssetConfig {
        bool enabled;
        uint8 id;
        bytes32 pythFeedId;
        uint64 k;
        uint64 sigmaFallback;
    }

    event OptedIn(
        address indexed borrower, address indexed collateral, uint32 trigger, uint16 maxDiscountBps
    );
    event TriggerSet(address indexed borrower, uint32 trigger);
    event MaxDiscountSet(address indexed borrower, uint16 maxDiscountBps);
    event OptedOut(address indexed borrower);
    event CoverLapsed(address indexed borrower);
    event CoverRestored(address indexed borrower);
    event RecordClosed(address indexed borrower);
    event AssetConfigured(
        address indexed collateral, uint8 id, bytes32 pythFeedId, uint64 k, uint64 sigmaFallback, bool enabled
    );
    event ExitParamsSet(uint16 exitDiscountBps, uint32 exitHfBuffer, uint32 dMin);
    event ModulesSet(address repricer, address executor);

    error TriggerOutOfRange(uint32 trigger);
    error MaxDiscountOutOfRange(uint16 maxDiscountBps, uint16 minimum);
    error AssetNotEnabled(address collateral);
    error AlreadyActive(address borrower);
    error NotActive(address borrower);
    error NotRepricer();
    error NotExecutor();
    error ModulesAlreadySet();
    error InvalidParameter();

    function FLAG_ACTIVE() external view returns (uint8);
    function FLAG_LAPSED() external view returns (uint8);
    function FLAG_EXITED() external view returns (uint8);

    function optIn(address collateral, uint32 trigger, uint16 maxDiscountBps) external;
    function setTrigger(uint32 trigger) external;
    function setMaxDiscount(uint16 maxDiscountBps) external;
    function optOut() external;

    function record(address borrower) external view returns (Record memory);
    function recordSlot(address borrower) external pure returns (uint256);
    function collateralOf(address borrower) external view returns (address);
    function assetConfig(address collateral) external view returns (AssetConfig memory);
    function assetAt(uint8 id) external view returns (address);
    function assets() external view returns (address[] memory);
    function activeCount() external view returns (uint256);
    function activeBorrowers(uint256 offset, uint256 limit) external view returns (address[] memory);

    function repricer() external view returns (address);
    function executor() external view returns (address);
    function exitDiscountBps() external view returns (uint16);
    function exitHfBuffer() external view returns (uint32);
    function dMin() external view returns (uint32);

    function writeRepricerState(
        address borrower,
        uint128 prepaid,
        uint128 accrued,
        uint96 premiumPerBlock,
        uint32 healthFactorBps,
        uint64 sigma,
        bool lapsed
    ) external;
    function creditPrepaid(address borrower, uint128 amount) external;
    function debitPrepaid(address borrower, uint128 amount) external;
    function markExited(address borrower) external;
}

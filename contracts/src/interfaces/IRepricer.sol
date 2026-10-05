// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title IRepricer
/// @notice Per-block premium accrual against each borrower's prepaid balance.
interface IRepricer {
    /// @notice Emitted on every reprice. Money values are 18-decimal units of the vault asset.
    event Repriced(
        address indexed borrower,
        uint256 charged,
        uint256 premiumPerBlock,
        uint256 healthFactor,
        uint256 sigma,
        uint256 prepaid,
        bool lapsed
    );
    event PriceSampled(bytes32 indexed feedId, int64 price, uint64 publishTime, uint16 count);
    event ToppedUp(address indexed borrower, uint256 amount);
    event Withdrawn(address indexed borrower, uint256 amount);
    event PremiumForwarded(uint256 amount);
    event ProtocolPremiumPaid(address indexed treasury, uint256 amount);
    event BlockTimeSet(uint32 blockTimeMs);

    error NotExecutor();
    error NotRegistry();
    error InsufficientUpdateFee(uint256 fee, uint256 sent);
    error InsufficientPrepaid(uint256 requested, uint256 available);
    error ZeroAmount();
    error RefundFailed();
    error InvalidParameter();

    function reprice(address borrower, bytes[] calldata pythUpdate) external payable;
    function repriceMany(address[] calldata borrowers, bytes[] calldata pythUpdate) external payable;
    function settleForExit(address borrower) external;
    function settleForOptOut(address borrower) external;
    function topUp(uint256 amount) external;
    function withdrawUnused(uint256 amount) external;
    function sweep() external returns (uint256 amount);
    function sweepProtocol() external returns (uint256 amount);
    function pendingPremium() external view returns (uint256);
    function pendingProtocolPremium() external view returns (uint256);

    function quote(address borrower)
        external
        view
        returns (uint256 premiumPerBlock, uint256 healthFactor, uint256 sigma, uint256 annualPremium);
    function quoteFor(address borrower, address collateral, uint32 trigger)
        external
        view
        returns (uint256 premiumPerBlock, uint256 healthFactor, uint256 sigma, uint256 annualPremium);
    function sigmaOf(bytes32 feedId, uint64 fallbackSigma) external view returns (uint256);
    function volSlot(bytes32 feedId) external pure returns (uint256);
}

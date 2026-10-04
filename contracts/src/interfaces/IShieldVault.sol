// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title IShieldVault
/// @notice The hooks the Executor and Repricer call on the ERC-4626 vault.
interface IShieldVault {
    event ExitFunded(uint256 amount);
    event CollateralReceived(
        address indexed collateral, uint256 aTokenAmount, uint256 usdcSpent, uint256 valueUsdc
    );
    event PremiumReceived(uint256 amount);
    event Unwound(address indexed collateral, uint256 amountIn, uint256 amountOut);
    event ModulesSet(address executor, address repricer);
    event UnwinderSet(address unwinder);
    event SwapperSet(address swapper, uint16 maxSwapSlippageBps);

    error NotExecutor();
    error NotRepricer();
    error NotUnwinder();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error ModulesAlreadySet();
    error InvalidParameter();
    error SwapBelowMinimum(uint256 amountOut, uint256 minimum);

    function availableLiquidity() external view returns (uint256);
    function fundExit(uint256 amount) external;
    function recordExit(address collateral, uint256 aTokenAmount, uint256 usdcSpent, uint256 valueUsdc)
        external;
    function notifyPremium(uint256 amount) external;
}

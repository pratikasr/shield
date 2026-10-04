// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title ISwapper
/// @notice A swap venue adapter. The caller approves `tokenIn`; the swapper pulls it, swaps, sends `tokenOut`
/// to `recipient` and returns any unused `tokenIn` to the caller.
interface ISwapper {
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);

    function swapExactOut(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient
    ) external returns (uint256 amountIn);
}

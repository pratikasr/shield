// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ISwapper} from "../interfaces/ISwapper.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Uniswap V3 SwapRouter02 single-pool swaps (IV3SwapRouter: no deadline field).
interface IV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        returns (uint256 amountIn);
}

/// @title UniswapV3Swapper
/// @notice Shield's swap adapter for the flash-loan fallback and vault unwinds: one Uniswap V3 pool per pair
/// through SwapRouter02 on Monad (ADR-018). Callers bound every swap by the Aave oracle, so this contract
/// only routes; it holds no funds between calls.
contract UniswapV3Swapper is ISwapper, Ownable2Step {
    using SafeERC20 for IERC20;

    IV3SwapRouter public immutable router;
    /// @notice Fee tier used when a pair has none set (0.3%, the WETH/USDC pool with liquidity on Monad).
    uint24 public constant DEFAULT_FEE = 3000;

    mapping(bytes32 pair => uint24 fee) private _fees;

    event PoolFeeSet(address indexed tokenA, address indexed tokenB, uint24 fee);

    constructor(address owner_, IV3SwapRouter router_) Ownable(owner_) {
        router = router_;
    }

    function setPoolFee(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        _fees[_pairKey(tokenA, tokenB)] = fee;
        emit PoolFeeSet(tokenA, tokenB, fee);
    }

    function poolFee(address tokenA, address tokenB) public view returns (uint24) {
        uint24 fee = _fees[_pairKey(tokenA, tokenB)];
        return fee == 0 ? DEFAULT_FEE : fee;
    }

    /// @inheritdoc ISwapper
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        amountOut = router.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee(tokenIn, tokenOut),
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(router), 0);
    }

    /// @inheritdoc ISwapper
    function swapExactOut(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient
    ) external returns (uint256 amountIn) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);
        IERC20(tokenIn).forceApprove(address(router), maxAmountIn);
        amountIn = router.exactOutputSingle(
            IV3SwapRouter.ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee(tokenIn, tokenOut),
                recipient: recipient,
                amountOut: amountOut,
                amountInMaximum: maxAmountIn,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(router), 0);
        if (maxAmountIn > amountIn) IERC20(tokenIn).safeTransfer(msg.sender, maxAmountIn - amountIn);
    }

    function _pairKey(address a, address b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}

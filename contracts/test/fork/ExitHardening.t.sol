// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Executor} from "../../src/Executor.sol";
import {IShieldVault} from "../../src/interfaces/IShieldVault.sol";
import {ISwapper} from "../../src/interfaces/ISwapper.sol";
import {MonadAddresses as M} from "../utils/MonadAddresses.sol";
import {ForkBase} from "./ForkBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Regression tests for the findings of the 5 Oct 2026 audit (docs/AUDIT.md), on a Monad mainnet fork.
contract ExitHardeningTest is ForkBase {
    function setUp() public override {
        super.setUp();
        _openPosition(borrower, 2e18, 11_000); // 2 WETH, HF 1.10
        _optIn(borrower, 10_400, 50e6);
        _nextBlock();
        vm.prank(keeper);
        d.repricer.reprice(borrower, _none());
    }

    function _dueNow() internal {
        _nextBlock();
        _dropPriceToHf(borrower, 10_380);
        _nextBlock();
    }

    // ------------------------------------------------------------ F1: trust balances, not swapper return values

    /// @notice A swapper that takes the collateral and reports a fill without paying cannot drain the vault.
    function test_F1_unwind_revertsWhenSwapperDoesNotPay() public {
        _seedVault(50_000e6);
        _dueNow();
        (, uint256 seized) = d.executor.exit(borrower, _none());
        ReportingOnlySwapper bad = new ReportingOnlySwapper();
        d.vault.setSwapper(ISwapper(address(bad)), 300);
        vm.expectRevert(abi.encodeWithSelector(IShieldVault.SwapBelowMinimum.selector, 0, _floor(seized)));
        d.vault.unwind(M.WETH, seized, 0);
    }

    /// @notice Collateral a swapper leaves behind is supplied back to Aave, so the share price still counts it.
    function test_F1_unwind_resuppliesUnsoldCollateral() public {
        _seedVault(50_000e6);
        _dueNow();
        (, uint256 seized) = d.executor.exit(borrower, _none());
        HalfFillSwapper half = new HalfFillSwapper();
        deal(M.USDC, address(half), 1_000_000e6);
        d.vault.setSwapper(ISwapper(address(half)), 300);
        uint256 grossBefore = d.vault.grossAssets();
        d.vault.unwind(M.WETH, seized, 0);
        assertEq(weth.balanceOf(address(d.vault)), 0, "no raw WETH left idle");
        assertApproxEqAbs(
            aWeth.balanceOf(address(d.vault)), seized - seized / 2, 2, "half re-supplied as aWETH"
        );
        assertGe(d.vault.grossAssets() + 2, grossBefore, "nothing lost from NAV");
    }

    /// @notice On the flash path, a swapper that reports a fill without paying makes the exit revert.
    function test_F1_flashExit_revertsWhenSwapperDoesNotPay() public {
        _dueNow();
        ReportingOnlySwapper bad = new ReportingOnlySwapper();
        d.executor.setSwapper(ISwapper(address(bad)));
        vm.expectPartialRevert(Executor.SwapShortfall.selector);
        d.executor.exit(borrower, _none());
        assertEq(d.registry.activeCount(), 1, "cover stays active");
    }

    // ------------------------------------------------------------ F2: the vault never loses on a flash exit

    /// @notice A fill at the Executor's own price bound would cost the vault its whole contribution; the exit
    /// reverts instead.
    function test_F2_flashExit_revertsWhenVaultWouldLose() public {
        _seedVault(20e6);
        _dueNow();
        BoundFillSwapper market = new BoundFillSwapper();
        deal(M.USDC, address(market), 1_000_000e6);
        d.executor.setSwapper(ISwapper(address(market)));
        uint256 navBefore = d.vault.grossAssets();
        vm.expectPartialRevert(Executor.VaultWouldLose.selector);
        d.executor.exit(borrower, _none());
        assertEq(d.vault.grossAssets(), navBefore, "vault untouched");
    }

    /// @notice With a fair market (fills at the oracle price), a mostly flash-funded exit still runs and the
    /// vault ends with more than it paid.
    function test_F2_flashExit_fairFillStillRuns() public {
        _seedVault(20e6);
        _dueNow();
        OracleFillSwapper fair = new OracleFillSwapper(address(oracle));
        deal(M.USDC, address(fair), 1_000_000e6);
        d.executor.setSwapper(ISwapper(address(fair)));
        uint256 grossBefore = d.vault.grossAssets();
        d.executor.exit(borrower, _none());
        assertGt(d.vault.grossAssets(), grossBefore, "vault gains");
    }

    // ------------------------------------------------------------ F3: exit gains unlock over time

    /// @notice Depositing just before an exit and redeeming just after earns nothing; the LPs who carried the
    /// cover receive the discount as it unlocks.
    function test_F3_jitDepositAroundExit_capturesNothing() public {
        _seedVault(5000e6);
        _dueNow();
        uint256 lpBefore = d.vault.previewRedeem(d.vault.balanceOf(lp));

        address jit = makeAddr("jit");
        // The depositor allowlist (ADR-039) refuses an outsider today; the unlock is what protects the vault once
        // outside depositors are allowed, so this test allows the attacker.
        d.vault.setDepositor(jit, true);
        uint256 amount = 500_000e6;
        deal(M.USDC, jit, amount);
        vm.startPrank(jit);
        usdc.approve(address(d.vault), amount);
        d.vault.deposit(amount, jit);
        d.executor.exit(borrower, _none());
        uint256 out = d.vault.redeem(d.vault.maxRedeem(jit), jit, jit);
        vm.stopPrank();
        // Only the premium settled at the exit (a few millionths of a USDC) reaches the share price at once.
        assertLe(out, amount + 0.01e6, "same-block depositor gains nothing of the discount");

        vm.warp(block.timestamp + d.vault.PROFIT_UNLOCK_SECONDS());
        uint256 lpGain = d.vault.previewRedeem(d.vault.balanceOf(lp)) - lpBefore;
        assertGt(lpGain, 9e6, "existing LP receives the discount once it unlocks");
        assertEq(d.vault.lockedProfit(), 0);
    }

    /// @notice The gain unlocks linearly: half of it is in the share price halfway through.
    function test_F3_profitUnlocksLinearly() public {
        _seedVault(50_000e6);
        _dueNow();
        uint256 before = d.vault.totalAssets();
        d.executor.exit(borrower, _none());
        uint256 locked = d.vault.lockedProfit();
        assertGt(locked, 0);
        assertApproxEqAbs(
            d.vault.totalAssets(), before, 0.01e6, "the discount does not reach the share price at once"
        );
        vm.warp(block.timestamp + d.vault.PROFIT_UNLOCK_SECONDS() / 2);
        assertApproxEqRel(d.vault.lockedProfit(), locked / 2, 0.01e18);
    }

    // ------------------------------------------------------------ H-1: cover cannot be bought on demand

    /// @notice New cover waits minCoverSeconds before it can exit; after that the exit runs.
    function test_H1_exitRefusedDuringWaitingPeriod() public {
        _seedVault(50_000e6);
        d.executor.setMinCoverSeconds(900);
        address late = makeAddr("late");
        _openPosition(late, 2e18, 11_000);
        _optIn(late, 10_400, 50e6);
        _dueNow();
        _dropPriceToHf(late, 10_380);
        assertEq(uint256(_status(late)), uint256(Executor.Status.CoverWarmingUp));
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.CoverWarmingUp));
        d.executor.exit(late, _none());
        vm.warp(block.timestamp + 900);
        _pushPyth(oracle.getAssetPrice(M.WETH));
        d.executor.exit(late, _none());
        assertGt(_hf(late), 1.09e18);
    }

    /// @notice Restoring a lapsed cover with a dust top-up at the moment of need restarts the waiting period.
    function test_H1_dustRestoreAtTheMomentOfNeed_isRefused() public {
        _seedVault(50_000e6);
        vm.prank(borrower);
        d.repricer.withdrawUnused(50e6 - 1);
        _nextBlock();
        vm.roll(block.number + 5_000_000);
        vm.prank(keeper);
        d.repricer.reprice(borrower, _none());
        assertTrue(d.registry.record(borrower).flags & d.registry.FLAG_LAPSED() != 0, "lapsed");
        d.executor.setMinCoverSeconds(900);
        _dropPriceToHf(borrower, 10_380);
        deal(M.USDC, borrower, 1);
        vm.startPrank(borrower);
        usdc.approve(address(d.repricer), 1);
        d.repricer.topUp(1);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.CoverWarmingUp));
        d.executor.exit(borrower, _none());
    }

    /// @notice A position at or below its trigger pays the floor rate while it waits, never zero.
    function test_H1_triggerAboveHf_paysTheFloorRate() public {
        address eager = makeAddr("eager");
        _openPosition(eager, 2e18, 11_000);
        _optIn(eager, 12_000, 50e6); // trigger 1.20 above HF 1.10
        _nextBlock();
        vm.prank(keeper);
        d.repricer.reprice(eager, _none());
        assertGt(d.registry.record(eager).premiumPerBlock, d.registry.record(borrower).premiumPerBlock);
    }

    // ------------------------------------------------------------ L2: settlement that empties the balance

    /// @notice If charging the blocks since the last reprice empties the prepaid balance, the cover lapses and
    /// the exit is refused.
    function test_L2_exitRefusedWhenSettlementLapsesCover() public {
        _seedVault(50_000e6);
        vm.prank(borrower);
        d.repricer.withdrawUnused(50e6 - 1); // leave one unit
        _nextBlock();
        vm.roll(block.number + 5_000_000); // no reprice in between: settlement must charge all of it
        _dropPriceToHf(borrower, 10_380);
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.CoverLapsed));
        d.executor.exit(borrower, _none());
    }

    function _floor(uint256 seized) internal view returns (uint256) {
        uint256 fair = seized * oracle.getAssetPrice(M.WETH) / 1e18 * 1e6 / oracle.getAssetPrice(M.USDC);
        return fair * (10_000 - 300) / 10_000;
    }
}

/// @notice Test-only: takes the input and reports `minAmountOut` (or `maxAmountIn`) without paying.
contract ReportingOnlySwapper is ISwapper {
    function swapExactIn(address tokenIn, address, uint256 amountIn, uint256 minAmountOut, address)
        external
        returns (uint256)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        return minAmountOut;
    }

    function swapExactOut(address tokenIn, address, uint256, uint256 maxAmountIn, address)
        external
        returns (uint256)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), maxAmountIn);
        return maxAmountIn;
    }
}

/// @notice Test-only: takes half the input and pays `minAmountOut`.
contract HalfFillSwapper is ISwapper {
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external returns (uint256) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn / 2);
        IERC20(tokenOut).transfer(to, minAmountOut);
        return minAmountOut;
    }

    function swapExactOut(address, address, uint256, uint256, address) external pure returns (uint256) {
        return 0;
    }
}

/// @notice Test-only model of a market that fills exactly at the caller's limit.
contract BoundFillSwapper is ISwapper {
    function swapExactIn(address, address, uint256, uint256, address) external pure returns (uint256) {
        return 0;
    }

    function swapExactOut(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address to
    ) external returns (uint256) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), maxAmountIn);
        IERC20(tokenOut).transfer(to, amountOut);
        return maxAmountIn;
    }
}

interface IOracleLike {
    function getAssetPrice(address) external view returns (uint256);
}

/// @notice Test-only model of a deep market that fills WETH for USDC at Aave's oracle price.
contract OracleFillSwapper is ISwapper {
    IOracleLike internal immutable oracle;

    constructor(address oracle_) {
        oracle = IOracleLike(oracle_);
    }

    function swapExactIn(address, address, uint256, uint256, address) external pure returns (uint256) {
        return 0;
    }

    function swapExactOut(address tokenIn, address tokenOut, uint256 amountOut, uint256, address to)
        external
        returns (uint256 amountIn)
    {
        // USDC out (6 decimals) priced against WETH in (18 decimals), both at Aave's oracle, rounded up.
        amountIn = (amountOut * oracle.getAssetPrice(tokenOut) * 1e12 + oracle.getAssetPrice(tokenIn) - 1)
            / oracle.getAssetPrice(tokenIn);
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(to, amountOut);
    }
}

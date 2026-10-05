// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Executor} from "../../src/Executor.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {ISwapper} from "../../src/interfaces/ISwapper.sol";
import {MonadAddresses as M} from "../utils/MonadAddresses.sol";
import {ForkBase} from "./ForkBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Test.sol";

/// @notice Every Aave path of the exit on a Monad mainnet fork: vault funding, flash-loan fallback, mixed
/// funding, and each reason an exit is refused.
contract ExitForkTest is ForkBase {
    uint256 internal constant WAD = 1e18;

    function setUp() public override {
        super.setUp();
        _seedVault(50_000e6);
        _openPosition(borrower, 2e18, 11_000); // 2 WETH, HF 1.10
        _optIn(borrower, 10_400, 50e6);
        _nextBlock();
        vm.prank(keeper);
        d.repricer.reprice(borrower, _none());
    }

    // ------------------------------------------------------------ vault-funded exit

    function test_exit_vaultFunded_restoresTargetHf() public {
        _dropPriceToHf(borrower, 10_380); // HF 1.038, under the 1.04 trigger
        _nextBlock();
        uint256 hfBefore = _hf(borrower);
        uint256 debtBefore = vUsdc.balanceOf(borrower);
        uint256 vaultUsdcBefore = usdc.balanceOf(address(d.vault));
        (Executor.Status s, uint256 repayAmount, uint256 seizeAmount,) = d.executor.previewExit(borrower);
        assertEq(uint256(s), uint256(Executor.Status.Ready));

        vm.recordLogs();
        vm.prank(keeper);
        (uint256 repaid, uint256 seized) = d.executor.exit(borrower, _none());
        vm.snapshotGasLastCall("exit_vaultFunded");

        uint256 hfAfter = _hf(borrower);
        assertEq(repaid, repayAmount);
        assertEq(seized, seizeAmount);
        assertGt(hfAfter, WAD, "HF above 1.0");
        assertGt(hfAfter, hfBefore, "HF improved");
        assertApproxEqRel(hfAfter, 1.1e18, 0.002e18, "HF restored to trigger + 0.06");
        assertApproxEqAbs(debtBefore - vUsdc.balanceOf(borrower), repaid, 2, "debt reduced by repaid");
        // The vault paid the repay; the premium settled at the exit was swept in during the same call.
        assertApproxEqAbs(
            vaultUsdcBefore - usdc.balanceOf(address(d.vault)), repaid, 0.01e6, "vault paid the repay"
        );
        assertGe(aWeth.balanceOf(address(d.vault)), seized, "vault holds the seized aWETH");

        // Seized collateral is worth 1.01 x repaid at Aave's oracle.
        uint256 seizedValue =
            seized * oracle.getAssetPrice(M.WETH) / 1e18 * 1e6 / oracle.getAssetPrice(M.USDC);
        assertApproxEqRel(seizedValue, repaid * 101 / 100, 0.0005e18);

        IPositionRegistry.Record memory r = d.registry.record(borrower);
        assertEq(r.flags, d.registry.FLAG_EXITED());
        assertEq(d.registry.activeCount(), 0);
        assertEq(d.vault.exitsExecuted(), 1);
        assertApproxEqAbs(d.vault.averageDiscountBps(), 100, 1, "1% captured");

        _assertExitedEvent(vm.getRecordedLogs(), repaid, seized, hfBefore, hfAfter);
    }

    function test_exit_raisesNavByTheDiscount_andUnwinds() public {
        _dropPriceToHf(borrower, 10_380);
        _nextBlock();
        uint256 navBefore = d.vault.totalAssets();
        (uint256 repaid, uint256 seized) = d.executor.exit(borrower, _none());
        assertApproxEqAbs(d.vault.totalAssets(), navBefore, 0.01e6, "the gain is locked at first (audit F3)");
        vm.warp(block.timestamp + d.vault.PROFIT_UNLOCK_SECONDS());
        uint256 gain = d.vault.totalAssets() - navBefore;
        assertApproxEqRel(
            gain, repaid / 100, 0.01e18, "NAV rises by about 1% of the repaid debt once unlocked"
        );

        // Unwind half the seized collateral through Uniswap V3, bounded by oracle value less 3%.
        uint256 usdcBefore = usdc.balanceOf(address(d.vault));
        vm.prank(keeper);
        uint256 out = d.vault.unwind(M.WETH, seized / 2, 0);
        vm.snapshotGasLastCall("vault_unwind");
        assertEq(usdc.balanceOf(address(d.vault)) - usdcBefore, out);
        uint256 fair = (seized / 2) * oracle.getAssetPrice(M.WETH) / 1e18 * 1e6 / oracle.getAssetPrice(M.USDC);
        assertGe(out, fair * 97 / 100);
    }

    function test_exit_isPermissionless() public {
        _dropPriceToHf(borrower, 10_390);
        _nextBlock();
        vm.prank(makeAddr("anyone"));
        d.executor.exit(borrower, _none());
        assertGt(_hf(borrower), 1.09e18);
    }

    // ------------------------------------------------------------ flash-loan fallback

    function test_exit_flashLoanFallback_vaultEmpty() public {
        // A small position so the swap fits Uniswap V3's thin WETH/USDC pool on Monad.
        address small = makeAddr("small");
        _openPosition(small, 0.25e18, 11_000);
        _optIn(small, 10_400, 5e6);
        _drainVault();
        _nextBlock();
        _dropPriceToHf(small, 10_380);
        _nextBlock();
        // The swap is bounded by the oracle: give the pool a matching price by using the fork's real
        // Uniswap price as Aave's (the drop above was 0.5%; restore market price and move HF by borrowing).
        uint256 hfBefore = _hf(small);
        (Executor.Status s, uint256 repayAmount,,) = d.executor.previewExit(small);
        assertEq(uint256(s), uint256(Executor.Status.Ready));
        assertEq(d.vault.availableLiquidity(), 0);

        vm.prank(keeper);
        (uint256 repaid,) = d.executor.exit(small, _none());
        vm.snapshotGasLastCall("exit_flashLoan");

        assertEq(repaid, repayAmount);
        assertGt(_hf(small), hfBefore);
        assertGt(_hf(small), WAD);
        assertEq(usdc.balanceOf(address(d.executor)), 0, "executor keeps nothing");
        assertEq(aWeth.balanceOf(address(d.executor)), 0);
        assertGt(aWeth.balanceOf(address(d.vault)), 0, "vault keeps the unsold collateral");
    }

    function test_exit_mixedFunding_vaultShort() public {
        address small = makeAddr("small");
        _openPosition(small, 0.25e18, 11_000);
        _optIn(small, 10_400, 5e6);
        _drainVault();
        _seedVault(50e6); // part of the repay
        _nextBlock();
        _dropPriceToHf(small, 10_380);
        _nextBlock();
        vm.prank(keeper);
        d.executor.exit(small, _none());
        assertGt(_hf(small), 1.09e18);
        assertEq(usdc.balanceOf(address(d.executor)), 0);
    }

    function test_exit_revertsWhenVaultEmptyAndFlashLoanUnavailable() public {
        _drainVault();
        _setFlashLoans(M.USDC, false);
        _dropPriceToHf(borrower, 10_380);
        _nextBlock();
        vm.prank(keeper);
        vm.expectRevert(); // Aave: FlashloanDisabled
        d.executor.exit(borrower, _none());
        assertEq(d.registry.record(borrower).flags & d.registry.FLAG_ACTIVE(), d.registry.FLAG_ACTIVE());
    }

    // ------------------------------------------------------------ refusals

    function test_exit_revertsAboveTrigger() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.AboveTrigger));
        d.executor.exit(borrower, _none());
    }

    function test_exit_revertsForBorrowerNotOptedIn() public {
        address other = makeAddr("other");
        _openPosition(other, 1e18, 11_000);
        _dropPriceToHf(other, 10_300);
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.NotActive));
        d.executor.exit(other, _none());
    }

    function test_exit_doubleExitInOneBlock() public {
        _dropPriceToHf(borrower, 10_380);
        _nextBlock();
        d.executor.exit(borrower, _none());
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.NotActive));
        d.executor.exit(borrower, _none());
    }

    function test_exit_revertsWhenCoverLapsed() public {
        vm.prank(borrower);
        d.repricer.withdrawUnused(50e6 - 1); // leaves dust, then drain it by repricing
        _nextBlock();
        vm.roll(block.number + 5_000_000);
        d.repricer.reprice(borrower, _none());
        assertTrue(d.registry.record(borrower).flags & d.registry.FLAG_LAPSED() != 0);
        _dropPriceToHf(borrower, 10_380);
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.CoverLapsed));
        d.executor.exit(borrower, _none());
    }

    function test_exit_revertsWhenApprovalRevoked() public {
        vm.prank(borrower);
        aWeth.approve(address(d.executor), 0);
        _dropPriceToHf(borrower, 10_380);
        _nextBlock();
        assertEq(uint256(_status(borrower)), uint256(Executor.Status.AllowanceTooLow));
        vm.expectRevert(
            abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.AllowanceTooLow)
        );
        d.executor.exit(borrower, _none());
    }

    function test_exit_borrowerRepaidInFull_notDue() public {
        uint256 debt = vUsdc.balanceOf(borrower);
        deal(M.USDC, borrower, usdc.balanceOf(borrower) + debt + 1e6);
        vm.startPrank(borrower);
        usdc.approve(address(pool), type(uint256).max);
        pool.repay(M.USDC, type(uint256).max, 2, borrower);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.AboveTrigger));
        d.executor.exit(borrower, _none());
        // The premium falls to zero with no debt.
        _nextBlock();
        d.repricer.reprice(borrower, _none());
        assertEq(d.registry.record(borrower).premiumPerBlock, 0);
    }

    function test_exit_revertsOnStalePyth() public {
        _dropPriceToHf(borrower, 10_380);
        vm.warp(uint256(pythTime) + d.executor.exitMaxPriceAge() + 1);
        vm.roll(block.number + 1);
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.PythStale));
        d.executor.exit(borrower, _none());
        // A fresh update in the same call clears it.
        bytes[] memory u = _pythUpdateFor(M.ETH_USD_FEED, oracle.getAssetPrice(M.WETH));
        d.executor.exit(borrower, u);
        assertGt(_hf(borrower), 1.09e18);
    }

    function test_exit_pythUpdateForWrongFeed_doesNotHelp() public {
        _dropPriceToHf(borrower, 10_380);
        vm.warp(uint256(pythTime) + d.executor.exitMaxPriceAge() + 1);
        vm.roll(block.number + 1);
        bytes[] memory u = _pythUpdateFor(M.BTC_USD_FEED, 60_000e8);
        vm.expectRevert(abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.PythStale));
        d.executor.exit(borrower, u);
    }

    function test_exit_revertsOnOracleDeviation() public {
        _dropPriceToHf(borrower, 10_380);
        _nextBlock();
        // Pyth disagrees with Aave by 5%.
        bytes[] memory u = _pythUpdateFor(M.ETH_USD_FEED, oracle.getAssetPrice(M.WETH) * 105 / 100);
        vm.expectRevert(
            abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.OracleDeviation)
        );
        d.executor.exit(borrower, u);
    }

    function test_exit_revertsOnWidePythConfidence() public {
        _dropPriceToHf(borrower, 10_380);
        _nextBlock();
        uint256 price = oracle.getAssetPrice(M.WETH);
        pythTime = uint64(block.timestamp) > pythTime ? uint64(block.timestamp) : pythTime + 1;
        bytes[] memory u = new bytes[](1);
        // Same price as Aave, but a 3% confidence interval: wider than the 2% bound, so it cannot vouch.
        u[0] = mockPyth.createPriceFeedUpdateData(
            M.ETH_USD_FEED,
            int64(int256(price)),
            uint64(price * 3 / 100),
            -8,
            int64(int256(price)),
            0,
            pythTime
        );
        vm.expectRevert(
            abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.OracleDeviation)
        );
        d.executor.exit(borrower, u);
    }

    function test_exit_revertsInEMode() public {
        vm.prank(borrower);
        pool.setUserEMode(1);
        _dropPriceToHf(borrower, 10_380);
        vm.expectRevert(
            abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.EModeUnsupported)
        );
        d.executor.exit(borrower, _none());
    }

    function test_exit_revertsWhenDiscountRaisedAboveBorrowerMax() public {
        d.registry.setExitParams(200, 600, 100);
        _dropPriceToHf(borrower, 10_380);
        vm.expectRevert(
            abi.encodeWithSelector(Executor.ExitBlocked.selector, Executor.Status.DiscountAboveMax)
        );
        d.executor.exit(borrower, _none());
        vm.prank(borrower);
        d.registry.setMaxDiscount(200);
        d.executor.exit(borrower, _none());
    }

    // ------------------------------------------------------------ real borrower action, no price change

    /// @notice The demo path without touching any price: the borrower borrows more until HF reaches a
    /// trigger of 1.05 (borrowing alone stops at LT/LTV = 1.0435 for WETH).
    function test_exit_afterExtraBorrow_noPriceChange() public {
        vm.prank(borrower);
        d.registry.setTrigger(10_500);
        _borrowToHf(borrower, 10_450);
        _nextBlock();
        assertEq(uint256(_status(borrower)), uint256(Executor.Status.Ready));
        uint256 hfBefore = _hf(borrower);
        d.executor.exit(borrower, _none());
        assertApproxEqRel(_hf(borrower), 1.11e18, 0.002e18);
        assertGt(_hf(borrower), hfBefore);
    }

    // ------------------------------------------------------------ reentrancy and flash-loan entry points

    function test_executeOperation_rejectsDirectCall() public {
        vm.expectRevert(Executor.InvalidFlashLoan.selector);
        d.executor.executeOperation(M.USDC, 1, 0, address(d.executor), "");
    }

    function test_executeOperation_rejectsForeignInitiator() public {
        deal(M.USDC, address(this), 10e6);
        vm.expectRevert(); // Executor.InvalidFlashLoan inside Aave's flash loan
        pool.flashLoanSimple(address(d.executor), M.USDC, 1e6, "", 0);
    }

    function test_reentrancy_throughSwapperIsBlocked() public {
        ReenteringSwapper evil = new ReenteringSwapper(d.executor);
        d.executor.setSwapper(ISwapper(address(evil)));
        address small = makeAddr("small");
        _openPosition(small, 0.25e18, 11_000);
        _optIn(small, 10_400, 5e6);
        _drainVault();
        _dropPriceToHf(small, 10_380);
        _nextBlock();
        vm.expectRevert(); // ReentrancyGuardReentrantCall from the nested exit
        d.executor.exit(small, _none());
    }

    // ------------------------------------------------------------ HF invariant under fuzzed drops

    /// @notice Whatever the size and the drop, an exit either leaves HF above 1.0 and above where it started,
    /// or does not happen.
    /// forge-config: default.fuzz.runs = 24
    /// forge-config: ci.fuzz.runs = 24
    function testFuzz_exit_neverLeavesHfAtOrBelowOne(uint256 wethAmount, uint256 hfBps) public {
        wethAmount = bound(wethAmount, 0.1e18, 3e18);
        hfBps = bound(hfBps, 9000, 10_399);
        address user = makeAddr("fuzz");
        _openPosition(user, wethAmount, 11_000);
        _optIn(user, 10_400, 5e6);
        _dropPriceToHf(user, hfBps);
        _nextBlock();
        uint256 hfBefore = _hf(user);
        try d.executor.exit(user, _none()) {
            uint256 hfAfter = _hf(user);
            assertGt(hfAfter, WAD);
            assertGt(hfAfter, hfBefore);
        } catch {
            assertEq(d.registry.record(user).flags & d.registry.FLAG_ACTIVE(), d.registry.FLAG_ACTIVE());
        }
    }

    // ------------------------------------------------------------ helpers

    function _assertExitedEvent(Vm.Log[] memory logs, uint256 repaid, uint256 seized, uint256 hb, uint256 ha)
        internal
        pure
    {
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != Executor.Exited.selector) continue;
            found = true;
            (uint256 rp, uint256 sz, uint256 saved, uint256 b, uint256 a, uint256 flash) =
                abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256, uint256));
            assertEq(rp, repaid);
            assertEq(sz, seized);
            assertEq(saved, repaid * 450 / 10_000, "5.5% Aave bonus minus 1% discount");
            assertEq(b, hb);
            assertEq(a, ha);
            assertEq(flash, 0);
        }
        assertTrue(found, "Exited emitted");
    }

    function _drainVault() internal {
        uint256 shares = d.vault.maxRedeem(lp);
        if (shares == 0) return;
        vm.prank(lp);
        d.vault.redeem(shares, lp, lp);
    }
}

/// @notice Test-only swapper that tries to re-enter `exit` from inside the flash-loan leg.
contract ReenteringSwapper is ISwapper {
    Executor internal immutable executor;

    constructor(Executor executor_) {
        executor = executor_;
    }

    function swapExactIn(address, address, uint256, uint256, address) external pure returns (uint256) {
        return 0;
    }

    function swapExactOut(address, address, uint256, uint256, address) external returns (uint256) {
        executor.exit(address(0xbeef), new bytes[](0));
        return 0;
    }
}

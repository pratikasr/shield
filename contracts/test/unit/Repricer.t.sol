// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {Repricer} from "../../src/Repricer.sol";
import {ShieldVault} from "../../src/ShieldVault.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {IRepricer} from "../../src/interfaces/IRepricer.sol";
import {IShieldVault} from "../../src/interfaces/IShieldVault.sol";
import {PremiumMath} from "../../src/libraries/PremiumMath.sol";
import {MockAaveOracle, MockAavePool} from "../mocks/MockAave.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {Test, Vm} from "forge-std/Test.sol";

/// @notice Repricer accrual, lapse, top-up, withdrawal and the per-feed volatility window, against mocked Aave
/// and MockPyth. The same paths run against real Aave in test/fork.
contract RepricerTest is Test {
    PositionRegistry internal reg;
    Repricer internal rp;
    ShieldVault internal vault;
    MockAavePool internal pool;
    MockAaveOracle internal oracle;
    MockPyth internal pyth;
    MockERC20 internal usdc;
    address internal constant WETH = address(0xE7);
    bytes32 internal constant FEED = bytes32("ETH/USD");
    uint64 internal constant K = 0.00125e18;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal executor = makeAddr("executor");
    uint64 internal pythTime;

    function setUp() public {
        vm.warp(1_790_000_000);
        pythTime = uint64(block.timestamp);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pool = new MockAavePool();
        oracle = new MockAaveOracle();
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(WETH, 2700e8);
        pool.setReserve(WETH, address(new MockERC20("Aave WETH", "aWETH", 18)), address(0), 8400, 10_550, 18);
        pyth = new MockPyth(3600, 0);
        reg = new PositionRegistry(address(this));
        reg.setAsset(WETH, FEED, K, 0.8e18, true);
        vault = new ShieldVault(
            address(this), IERC20(address(usdc)), IPool(address(pool)), IAaveOracle(address(oracle)), reg
        );
        rp = new Repricer(
            address(this),
            reg,
            IPool(address(pool)),
            IAaveOracle(address(oracle)),
            IPyth(address(pyth)),
            IERC20(address(usdc)),
            vault
        );
        reg.setModules(address(rp), executor);
        vault.setModules(executor, address(rp));
        // Alice: $10,000 debt, HF 1.09, trigger 1.04 (d = 0.05).
        pool.setAccount(alice, 13_000e8, 10_000e8, 1.09e18);
        _fund(alice, 1000e6);
        vm.prank(alice);
        rp.topUp(100e6);
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(rp), type(uint256).max);
    }

    function _pythUpdate(int64 price) internal returns (bytes[] memory u) {
        pythTime += 1;
        u = new bytes[](1);
        u[0] = pyth.createPriceFeedUpdateData(FEED, price, 1e6, -8, price, 1e6, pythTime);
    }

    function _pythUpdateExpo(int64 price, uint64 conf, int32 expo) internal returns (bytes[] memory u) {
        pythTime += 1;
        u = new bytes[](1);
        u[0] = pyth.createPriceFeedUpdateData(FEED, price, conf, expo, price, conf, pythTime);
    }

    /// @notice A one-unit Pyth print neither saturates the window nor bricks the feed when it leaves the window
    /// 200 observations later (audit L-1).
    function test_volWindow_badPrintDoesNotBrickTheFeed() public {
        rp.reprice(alice, _pythUpdateExpo(2700e8, 1e6, -8));
        vm.roll(block.number + 1);
        rp.reprice(alice, _pythUpdateExpo(1, 0, -8));
        for (uint256 i; i < 201; ++i) {
            vm.roll(block.number + 1);
            rp.reprice(alice, _pythUpdateExpo(2700e8, 1e6, -8));
        }
        vm.prank(executor);
        rp.settleForExit(alice); // would revert with an arithmetic underflow before the fix
        assertLe(rp.sigmaOf(FEED, 0.8e18), rp.SIGMA_MAX());
    }

    /// @notice A change of Pyth exponent at an unchanged price is not read as a move (audit L-2).
    function test_volWindow_expoChangeIsNotAMove() public {
        int64 p = 2700e8;
        for (uint256 i; i < 30; ++i) {
            vm.roll(block.number + 1);
            p = i % 2 == 0 ? p * 10_001 / 10_000 : p * 10_000 / 10_001;
            rp.reprice(alice, _pythUpdateExpo(p, 1e6, -8));
        }
        uint256 before = rp.sigmaOf(FEED, 0.8e18);
        vm.roll(block.number + 1);
        rp.reprice(alice, _pythUpdateExpo(p * 100, 1e8, -10)); // the same dollar price, expo -10
        assertLe(rp.sigmaOf(FEED, 0.8e18), before * 11 / 10, "no jump from the exponent change");
    }

    function _none() internal pure returns (bytes[] memory) {
        return new bytes[](0);
    }

    // ------------------------------------------------------------ accrual

    /// @notice The blocks between opt-in and the first reprice are billed at the live rate: cover is never free
    /// before the keeper first prices it (audit H-1, M-3).
    function test_firstReprice_billsTheBlocksSinceOptIn() public {
        vm.roll(block.number + 10);
        rp.reprice(alice, _none());
        IPositionRegistry.Record memory r = reg.record(alice);
        // Calibration point: 2% of $10,000 a year at the fallback sigma of 80%.
        uint256 expected = PremiumMath.perBlock(200e18, 300);
        assertEq(r.accrued, expected * 10, "ten blocks at the live rate");
        assertEq(r.premiumPerBlock, expected);
        assertEq(r.healthFactorBps, 10_900);
        assertEq(r.sigma, 0.8e18);
    }

    /// @notice Elapsed blocks are billed at the higher of the stored and the live rate (audit M-3): when HF
    /// moves closer to the trigger the higher live rate applies.
    function test_reprice_billsHigherOfStoredAndLiveRate() public {
        rp.reprice(alice, _none());
        uint256 accrued0 = reg.record(alice).accrued;
        vm.roll(block.number + 25);
        pool.setAccount(alice, 13_000e8, 10_000e8, 1.06e18);
        uint256 live = PremiumMath.perBlock(200e18 * 5 / 2, 300);
        rp.reprice(alice, _none());
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.accrued - accrued0, live * 25);
        assertEq(r.premiumPerBlock, live);
    }

    /// @notice A rate stored from a momentarily improved position does not discount the next interval.
    function test_reprice_selfRepriceFromImprovedState_doesNotDiscount() public {
        rp.reprice(alice, _none());
        uint256 fair = reg.record(alice).premiumPerBlock;
        // The borrower repays in one transaction, reprices, and borrows back.
        pool.setAccount(alice, 13_000e8, 0, type(uint256).max);
        vm.prank(alice);
        rp.reprice(alice, _none());
        pool.setAccount(alice, 13_000e8, 10_000e8, 1.09e18);
        assertEq(reg.record(alice).premiumPerBlock, 0);
        uint256 accrued0 = reg.record(alice).accrued;
        vm.roll(block.number + 200);
        rp.reprice(alice, _none());
        assertEq(reg.record(alice).accrued - accrued0, fair * 200, "billed at the fair live rate");
    }

    function test_reprice_twiceInOneBlock_chargesOnce() public {
        rp.reprice(alice, _none());
        vm.roll(block.number + 3);
        rp.reprice(alice, _none());
        uint256 accrued = reg.record(alice).accrued;
        rp.reprice(alice, _none());
        assertEq(reg.record(alice).accrued, accrued);
    }

    /// @notice A position at or below its trigger pays the floor rate, the most expensive, never zero (H-1).
    function test_reprice_atOrBelowTrigger_paysTheFloorRate() public {
        pool.setAccount(alice, 13_000e8, 10_000e8, 1.04e18);
        rp.reprice(alice, _none());
        assertEq(reg.record(alice).premiumPerBlock, PremiumMath.perBlock(200e18 * 5, 300));
    }

    function test_reprice_revertsForInactive() public {
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.NotActive.selector, bob));
        rp.reprice(bob, _none());
    }

    function test_reprice_borrowerRepaidInFull_rateZero() public {
        pool.setAccount(alice, 13_000e8, 0, 0);
        rp.reprice(alice, _none());
        assertEq(reg.record(alice).premiumPerBlock, 0);
        assertEq(reg.record(alice).healthFactorBps, type(uint32).max, "HF saturates");
    }

    function test_premiumFlowsToVault_inWholeUnitsWithRemainder() public {
        // A large position so a few blocks are worth more than one USDC unit.
        pool.setAccount(alice, 1_300_000e8, 1_000_000e8, 1.09e18);
        rp.reprice(alice, _none());
        uint256 rate = reg.record(alice).premiumPerBlock;
        vm.roll(block.number + 100);
        rp.reprice(alice, _none());
        uint256 owed = rate * 100;
        // Repricing moves no tokens; the premium is pending and already counts toward NAV.
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(rp.pendingToVault(), owed);
        assertEq(vault.totalAssets(), owed / 1e12);
        assertEq(vault.premiumEarned(), owed / 1e12);
        // A sweep (anyone, or the vault itself when it pays out) moves whole units and keeps the remainder.
        assertEq(rp.sweep(), owed / 1e12);
        assertEq(usdc.balanceOf(address(vault)), owed / 1e12);
        assertEq(rp.pendingToVault(), owed % 1e12);
        assertEq(vault.totalPremiumEarned(), owed / 1e12);
        assertEq(rp.sweep(), 0, "nothing left to sweep");
    }

    // ---------------------------------------------------------------- protocol share (ADR-037)

    address internal treasury = makeAddr("treasury");

    function _chargeLarge(uint256 blocks) internal returns (uint256 owed) {
        pool.setAccount(alice, 1_300_000e8, 1_000_000e8, 1.09e18);
        rp.reprice(alice, _none());
        uint256 rate = reg.record(alice).premiumPerBlock;
        vm.roll(block.number + blocks);
        rp.reprice(alice, _none());
        owed = rate * blocks;
    }

    function test_protocolShare_splitsEachCharge() public {
        reg.setProtocolShare(treasury, 1000);
        uint256 owed = _chargeLarge(100);
        uint256 toTreasury = owed * 1000 / 10_000;
        assertEq(rp.pendingToTreasury(), toTreasury, "10% of the charge");
        assertEq(rp.pendingToVault(), owed - toTreasury, "the rest to the vault");
        // The vault's NAV and premium figures count only its own part.
        assertEq(vault.premiumEarned(), (owed - toTreasury) / 1e12);
        assertEq(rp.pendingProtocolPremium(), toTreasury / 1e12);
    }

    function test_protocolShare_sweepPaysTreasuryAndVault() public {
        reg.setProtocolShare(treasury, 1500);
        uint256 owed = _chargeLarge(100);
        uint256 toTreasury = owed * 1500 / 10_000;
        vm.expectEmit(true, false, false, true, address(rp));
        emit IRepricer.ProtocolPremiumPaid(treasury, toTreasury / 1e12);
        assertEq(rp.sweep(), (owed - toTreasury) / 1e12, "returns the vault's part");
        assertEq(usdc.balanceOf(treasury), toTreasury / 1e12);
        assertEq(usdc.balanceOf(address(vault)), (owed - toTreasury) / 1e12);
        assertEq(vault.totalPremiumEarned(), (owed - toTreasury) / 1e12);
        assertEq(rp.pendingToTreasury(), toTreasury % 1e12, "sub-unit remainder waits");
        assertEq(rp.pendingToVault(), (owed - toTreasury) % 1e12);
    }

    function test_protocolShare_changeAppliesOnlyToLaterCharges() public {
        reg.setProtocolShare(treasury, 2000);
        uint256 first = _chargeLarge(100);
        uint256 rate = reg.record(alice).premiumPerBlock;
        reg.setProtocolShare(treasury, 0);
        vm.roll(block.number + 50);
        rp.reprice(alice, _none());
        uint256 second = rate * 50;
        assertEq(rp.pendingToTreasury(), first * 2000 / 10_000, "the second charge owes the protocol nothing");
        assertEq(rp.pendingToVault(), first - first * 2000 / 10_000 + second);
        // Premium charged at the old share is still paid out after the share drops to zero.
        rp.sweep();
        assertEq(usdc.balanceOf(treasury), first * 2000 / 10_000 / 1e12);
    }

    function test_protocolShare_zeroByDefault_allToVault() public {
        assertEq(reg.protocolShareBps(), 0);
        uint256 owed = _chargeLarge(100);
        assertEq(rp.pendingToTreasury(), 0);
        assertEq(rp.pendingToVault(), owed);
    }

    function test_protocolShare_vaultSweepAlsoPaysTreasury() public {
        reg.setProtocolShare(treasury, 1000);
        _chargeLarge(1000);
        uint256 vaultPart = rp.pendingPremium();
        uint256 protocolPart = rp.pendingProtocolPremium();
        assertGt(protocolPart, 0);
        vm.prank(executor);
        vault.fundExit(vaultPart);
        assertEq(usdc.balanceOf(treasury), protocolPart, "the vault's sweep pays the treasury too");
        assertEq(usdc.balanceOf(executor), vaultPart);
    }

    function testFuzz_protocolShare_conservesEveryCharge(uint16 share, uint32 blocks) public {
        share = uint16(bound(share, 0, reg.MAX_PROTOCOL_SHARE_BPS()));
        blocks = uint32(bound(blocks, 1, 50_000));
        if (share != 0) reg.setProtocolShare(treasury, share);
        uint256 accruedBefore = reg.record(alice).accrued;
        pool.setAccount(alice, 1_300_000e8, 1_000_000e8, 1.09e18);
        rp.reprice(alice, _none());
        vm.roll(block.number + blocks);
        rp.reprice(alice, _none());
        uint256 charged = reg.record(alice).accrued - accruedBefore;
        assertEq(uint256(rp.pendingToVault()) + rp.pendingToTreasury(), charged, "nothing created or lost");
        assertLe(rp.pendingToTreasury(), charged * share / 10_000 + 1);
        rp.sweep();
        assertEq(
            usdc.balanceOf(address(vault)) * 1e12 + usdc.balanceOf(treasury) * 1e12 + rp.pendingToVault()
                + rp.pendingToTreasury(),
            charged
        );
    }

    function test_vaultPullsPendingPremiumWhenPayingOut() public {
        pool.setAccount(alice, 1_300_000e8, 1_000_000e8, 1.09e18);
        rp.reprice(alice, _none());
        vm.roll(block.number + 1000);
        rp.reprice(alice, _none());
        uint256 pending = rp.pendingPremium();
        assertGt(pending, 0);
        assertEq(vault.availableLiquidity(), pending);
        vm.prank(executor);
        vault.fundExit(pending);
        assertEq(usdc.balanceOf(executor), pending, "exit funded from swept premium");
        assertEq(vault.totalPremiumEarned(), pending);
    }

    function test_repriceGas_doesNotDependOnSweepThreshold() public {
        pool.setAccount(alice, 1_300_000e8, 1_000_000e8, 1.09e18);
        rp.reprice(alice, _none());
        vm.roll(block.number + 1);
        rp.reprice(alice, _none()); // first charge: pendingToVault slot goes from zero (one-time state growth)
        vm.roll(block.number + 1);
        rp.reprice(alice, _none());
        uint256 g1 = vm.lastCallGas().gasTotalUsed;
        vm.roll(block.number + 1);
        rp.reprice(alice, _none());
        uint256 g2 = vm.lastCallGas().gasTotalUsed;
        assertEq(g1, g2, "steady-state reprice gas is constant");
    }

    // ------------------------------------------------------------ lapse and top-up

    function test_prepaidExhausted_lapsesMidCover() public {
        pool.setAccount(alice, 1_300_000e8, 1_000_000e8, 1.05e18); // d at the floor: a high rate
        rp.reprice(alice, _none());
        uint256 rate = reg.record(alice).premiumPerBlock;
        uint256 blocksToEmpty = 100e18 / rate + 1;
        vm.roll(block.number + blocksToEmpty + 10);
        vm.expectEmit(address(reg));
        emit IPositionRegistry.CoverLapsed(alice);
        rp.reprice(alice, _none());
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.prepaid, 0);
        assertEq(r.accrued, 100e18, "charged exactly what was prepaid");
        assertTrue(r.flags & reg.FLAG_LAPSED() != 0);
        // While lapsed nothing is charged.
        vm.roll(block.number + 1000);
        rp.reprice(alice, _none());
        assertEq(reg.record(alice).accrued, 100e18);
        // Top-up restores cover and the lapsed blocks are never billed.
        vm.prank(alice);
        rp.topUp(10e6);
        r = reg.record(alice);
        assertEq(r.flags & reg.FLAG_LAPSED(), 0);
        vm.roll(block.number + 1);
        rp.reprice(alice, _none());
        assertEq(reg.record(alice).accrued, 100e18 + r.premiumPerBlock * 1);
    }

    function test_topUp_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(IRepricer.ZeroAmount.selector);
        rp.topUp(0);
    }

    function test_withdrawUnused_settlesFirst() public {
        rp.reprice(alice, _none());
        uint256 rate = reg.record(alice).premiumPerBlock;
        vm.roll(block.number + 40);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        rp.withdrawUnused(50e6);
        assertEq(usdc.balanceOf(alice) - before, 50e6);
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.accrued, rate * 40, "due premium charged before the withdrawal");
        assertEq(r.prepaid, 50e18 - rate * 40);
        assertGt(r.premiumPerBlock, 0, "cover keeps running");
    }

    function test_withdrawUnused_cannotExceedBalance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IRepricer.InsufficientPrepaid.selector, 101e6, 100e6));
        rp.withdrawUnused(101e6);
    }

    function test_withdrawAll_lapses() public {
        vm.prank(alice);
        rp.withdrawUnused(100e6);
        assertTrue(reg.record(alice).flags & reg.FLAG_LAPSED() != 0);
    }

    function test_settleForExit_onlyExecutor_andStopsRate() public {
        rp.reprice(alice, _none());
        vm.expectRevert(IRepricer.NotExecutor.selector);
        rp.settleForExit(alice);
        vm.roll(block.number + 5);
        vm.prank(executor);
        rp.settleForExit(alice);
        assertEq(reg.record(alice).premiumPerBlock, 0);
        assertGt(reg.record(alice).accrued, 0);
    }

    // ------------------------------------------------------------ repriceMany

    function test_repriceMany_skipsInactiveAndSamplesOnce() public {
        pool.setAccount(bob, 13_000e8, 10_000e8, 1.2e18);
        _fund(bob, 100e6);
        vm.prank(bob);
        rp.topUp(10e6);
        vm.prank(bob);
        reg.optIn(WETH, 10_400, 100);
        address[] memory list = new address[](3);
        list[0] = alice;
        list[1] = makeAddr("nobody");
        list[2] = bob;
        vm.recordLogs();
        rp.repriceMany(list, _pythUpdate(2700e8));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 sampled;
        uint256 repriced;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == IRepricer.PriceSampled.selector) ++sampled;
            if (logs[i].topics[0] == IRepricer.Repriced.selector) ++repriced;
        }
        assertEq(sampled, 1, "one feed, one sample");
        assertEq(repriced, 2, "two active borrowers");
    }

    // ------------------------------------------------------------ Pyth and the volatility window

    function test_pythUpdate_feeChargedAndRefunded() public {
        MockPyth paid = new MockPyth(3600, 7);
        Repricer rp2 = new Repricer(
            address(this),
            reg,
            IPool(address(pool)),
            IAaveOracle(address(oracle)),
            IPyth(address(paid)),
            IERC20(address(usdc)),
            vault
        );
        bytes[] memory u = new bytes[](1);
        u[0] = paid.createPriceFeedUpdateData(FEED, 2700e8, 1e6, -8, 2700e8, 1e6, uint64(block.timestamp));
        vm.deal(address(this), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IRepricer.InsufficientUpdateFee.selector, 7, 6));
        rp2.repriceMany{value: 6}(new address[](0), u);
        uint256 before = address(this).balance;
        rp2.repriceMany{value: 100}(new address[](0), u);
        assertEq(before - address(this).balance, 7, "only the fee is kept");
    }

    receive() external payable {}

    function test_sample_ignoresStaleOrRepeatedPublishTime() public {
        rp.reprice(alice, _pythUpdate(2700e8));
        (uint16 count,,,,) = rp.volState(FEED);
        assertEq(count, 1);
        vm.roll(block.number + 1);
        rp.reprice(alice, _none()); // same publish time: no new observation
        (count,,,,) = rp.volState(FEED);
        assertEq(count, 1);
    }

    function test_sample_wrongFeedUpdateDoesNotMoveOurFeed() public {
        rp.reprice(alice, _pythUpdate(2700e8));
        bytes[] memory u = new bytes[](1);
        u[0] = pyth.createPriceFeedUpdateData(
            bytes32("BTC/USD"), 60_000e8, 1e6, -8, 60_000e8, 1e6, pythTime + 50
        );
        vm.roll(block.number + 1);
        rp.reprice(alice, u);
        (uint16 count,,, uint64 newest,) = rp.volState(FEED);
        assertEq(count, 1, "an update for another feed adds no observation");
        assertEq(newest, pythTime);
    }

    function test_sample_skipsLowConfidencePrice() public {
        rp.reprice(alice, _pythUpdate(2700e8));
        pythTime += 1;
        bytes[] memory u = new bytes[](1);
        // Confidence of 5% of the price: Pyth is unsure, so it is not an observation.
        u[0] = pyth.createPriceFeedUpdateData(FEED, 2600e8, 130e8, -8, 2600e8, 130e8, pythTime);
        vm.roll(block.number + 1);
        rp.reprice(alice, u);
        (uint16 count,,,,) = rp.volState(FEED);
        assertEq(count, 1);
    }

    function test_sigma_fallbackUntilMinSamples() public {
        for (uint256 i; i < rp.MIN_SAMPLES() - 1; ++i) {
            vm.roll(block.number + 1);
            rp.reprice(alice, _pythUpdate(int64(int256(2700e8 + i * 1e8))));
        }
        assertEq(rp.sigmaOf(FEED, 0.8e18), 0.8e18);
        vm.roll(block.number + 1);
        rp.reprice(alice, _pythUpdate(2700e8));
        assertTrue(rp.sigmaOf(FEED, 0.8e18) != 0.8e18, "realised volatility takes over");
    }

    /// @notice The running sum of squared returns always equals a from-scratch recomputation over the
    /// observations still in the window, including after the ring buffer wraps.
    function testFuzz_volWindow_sumMatchesRecompute(uint256 seed, uint16 extra) public {
        uint256 n = 200 + bound(extra, 0, 260);
        int64[] memory prices = new int64[](n);
        uint256 x = seed;
        int256 p = 2700e8;
        for (uint256 i; i < n; ++i) {
            x = uint256(keccak256(abi.encode(x)));
            int256 stepBps = int256(x % 41) - 20; // -0.20% .. +0.20%
            p = p + p * stepBps / 10_000;
            prices[i] = int64(p);
            vm.roll(block.number + 1);
            rp.reprice(alice, _pythUpdate(int64(p)));
        }
        (uint16 count, uint16 head, uint128 sumSq, uint64 newest, uint64 oldest) = rp.volState(FEED);
        assertEq(count, 200);
        assertEq(head, n % 200);
        uint256 expected;
        for (uint256 i = n - 199; i < n; ++i) {
            expected += PremiumMath.squaredReturn(uint256(int256(prices[i - 1])), uint256(int256(prices[i])));
        }
        assertEq(sumSq, expected, "no drift in the running sum");
        assertEq(newest - oldest, 199, "window spans the last 200 publish times");
    }

    function test_volWindow_constantPrice_clampsToMinimum() public {
        for (uint256 i; i < 20; ++i) {
            vm.roll(block.number + 1);
            rp.reprice(alice, _pythUpdate(2700e8));
        }
        assertEq(rp.sigmaOf(FEED, 0.8e18), rp.SIGMA_MIN());
    }

    function test_volWindow_knownVolatility() public {
        // Alternate +1% and -1% each second: squared return about 1e-4 per second.
        int64 price = 2700e8;
        for (uint256 i; i < 101; ++i) {
            vm.roll(block.number + 1);
            rp.reprice(alice, _pythUpdate(price));
            price = i % 2 == 0 ? price * 101 / 100 : price * 100 / 101;
        }
        // sqrt(1e-4 * 31,536,000) is about 56.2, above the 500% clamp.
        assertEq(rp.sigmaOf(FEED, 0.8e18), rp.SIGMA_MAX());
    }

    function test_volSlot_pageAligned() public view {
        uint256 base = rp.volSlot(FEED);
        assertEq(base & 127, 0);
        assertEq(base >> 7, (base + 100) >> 7, "header and 100 sample slots share one page");
    }

    function test_quoteFor_beforeOptIn() public {
        pool.setAccount(bob, 13_000e8, 10_000e8, 1.09e18);
        (uint256 perBlock,, uint256 sigma, uint256 annual) = rp.quoteFor(bob, WETH, 10_400);
        assertEq(annual, 200e18);
        assertEq(perBlock, PremiumMath.perBlock(200e18, 300));
        assertEq(sigma, 0.8e18);
    }

    function test_setBlockTimeMs_bounds() public {
        vm.expectRevert(IRepricer.InvalidParameter.selector);
        rp.setBlockTimeMs(50);
        rp.setBlockTimeMs(400);
        assertEq(rp.blockTimeMs(), 400);
    }

    function test_notifyPremium_onlyRepricer() public {
        vm.expectRevert(IShieldVault.NotRepricer.selector);
        vault.notifyPremium(1);
    }
}

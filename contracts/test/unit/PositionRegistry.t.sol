// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Record packing, MIP-8 page alignment, opt-in rules and the active list.
contract PositionRegistryTest is Test {
    PositionRegistry internal reg;
    address internal constant WETH = address(0xE7);
    address internal constant CBBTC = address(0xCB);
    address internal repricer = makeAddr("repricer");
    address internal executor = makeAddr("executor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        reg = new PositionRegistry(address(this));
        reg.setAsset(WETH, bytes32("ETH/USD"), 0.00125e18, 0.8e18, true);
        reg.setAsset(CBBTC, bytes32("CBBTC/USD"), 0.00125e18, 0.8e18, true);
        reg.setModules(repricer, executor);
    }

    // ------------------------------------------------------------ MIP-8 layout

    function testFuzz_recordSlot_isPageAlignedAndRecordFitsOnePage(address borrower) public view {
        uint256 base = reg.recordSlot(borrower);
        assertEq(base & 127, 0, "base slot starts a 128-slot page");
        assertEq(base >> 7, (base + 2) >> 7, "all three record slots are in the same page");
    }

    function test_recordSlots_distinctPagesPerBorrower() public view {
        assertTrue(reg.recordSlot(alice) >> 7 != reg.recordSlot(bob) >> 7);
    }

    function test_record_readsRawStorageLayout() public {
        vm.roll(1234);
        vm.warp(5678);
        vm.prank(alice);
        reg.optIn(CBBTC, 10_400, 150);
        uint256 base = reg.recordSlot(alice);
        uint256 s0 = uint256(vm.load(address(reg), bytes32(base)));
        assertEq(uint32(s0), 10_400, "trigger in bits 0..31");
        assertEq(uint16(s0 >> 32), 150, "maxDiscountBps in bits 32..47");
        assertEq(uint8(s0 >> 48), reg.FLAG_ACTIVE() | reg.FLAG_LAPSED(), "flags in bits 48..55");
        assertEq(uint8(s0 >> 56), 1, "collateral id in bits 56..63");
        assertEq(uint64(s0 >> 64), 1234, "last repriced block in bits 64..127");
        assertEq(uint32(s0 >> 128), 1, "list index in bits 128..159");
        assertEq(uint64(s0 >> 160), 5678, "opted-in time in bits 160..223");
    }

    function testFuzz_packing_roundTrip(
        uint128 prepaid,
        uint128 accrued,
        uint96 rate,
        uint32 hfBps,
        uint64 sigma,
        bool lapsed
    ) public {
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
        vm.roll(block.number + 7);
        vm.prank(repricer);
        reg.writeRepricerState(alice, prepaid, accrued, rate, hfBps, sigma, lapsed);
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.prepaid, prepaid);
        assertEq(r.accrued, accrued);
        assertEq(r.premiumPerBlock, rate);
        assertEq(r.healthFactorBps, hfBps);
        assertEq(r.sigma, sigma);
        assertEq(r.flags & reg.FLAG_LAPSED() != 0, lapsed);
        assertEq(r.flags & reg.FLAG_ACTIVE(), reg.FLAG_ACTIVE(), "active flag untouched");
        assertEq(r.trigger, 10_400, "slot 0 fields untouched");
        assertEq(r.maxDiscountBps, 100);
        assertEq(r.lastRepricedBlock, block.number);
        uint256 base = reg.recordSlot(alice);
        uint256 s1 = uint256(vm.load(address(reg), bytes32(base + 1)));
        assertEq(s1, uint256(prepaid) | (uint256(accrued) << 128), "slot 1 layout");
    }

    // ------------------------------------------------------------ opt-in rules

    function test_optIn_recordsAndEmits() public {
        vm.expectEmit(address(reg));
        emit IPositionRegistry.OptedIn(alice, WETH, 10_400, 100);
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.trigger, 10_400);
        assertEq(reg.collateralOf(alice), WETH);
        assertEq(reg.activeCount(), 1);
        // No prepaid balance yet: active but unprotected.
        assertEq(r.flags, reg.FLAG_ACTIVE() | reg.FLAG_LAPSED());
    }

    function test_optIn_revertsTriggerBelowOneOhOne() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.TriggerOutOfRange.selector, uint32(9900)));
        reg.optIn(WETH, 9900, 100);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.TriggerOutOfRange.selector, uint32(10_099)));
        reg.optIn(WETH, 10_099, 100);
    }

    function test_optIn_revertsTriggerAboveTwo() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.TriggerOutOfRange.selector, uint32(20_001)));
        reg.optIn(WETH, 20_001, 100);
    }

    function test_optIn_revertsMaxDiscountBelowOnePercent() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IPositionRegistry.MaxDiscountOutOfRange.selector, uint16(99), uint16(100))
        );
        reg.optIn(WETH, 10_400, 99);
    }

    function test_optIn_revertsMaxDiscountAboveCeiling() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IPositionRegistry.MaxDiscountOutOfRange.selector, uint16(501), uint16(100))
        );
        reg.optIn(WETH, 10_400, 501);
    }

    function test_optIn_revertsUnknownAsset() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.AssetNotEnabled.selector, address(0xdead)));
        reg.optIn(address(0xdead), 10_400, 100);
    }

    function test_optIn_revertsDisabledAsset() public {
        reg.setAsset(WETH, bytes32("ETH/USD"), 0.00125e18, 0.8e18, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.AssetNotEnabled.selector, WETH));
        reg.optIn(WETH, 10_400, 100);
    }

    function test_optIn_revertsTwice() public {
        vm.startPrank(alice);
        reg.optIn(WETH, 10_400, 100);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.AlreadyActive.selector, alice));
        reg.optIn(WETH, 10_500, 100);
    }

    function test_optIn_withPrepaidIsProtected() public {
        vm.prank(repricer);
        reg.creditPrepaid(alice, 5e18);
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
        assertEq(reg.record(alice).flags, reg.FLAG_ACTIVE());
    }

    function test_setTrigger_and_setMaxDiscount() public {
        vm.startPrank(alice);
        reg.optIn(WETH, 10_400, 100);
        vm.expectEmit(address(reg));
        emit IPositionRegistry.TriggerSet(alice, 10_800);
        reg.setTrigger(10_800);
        reg.setMaxDiscount(250);
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.trigger, 10_800);
        assertEq(r.maxDiscountBps, 250);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.TriggerOutOfRange.selector, uint32(10_000)));
        reg.setTrigger(10_000);
    }

    function test_setTrigger_revertsWhenNotActive() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.NotActive.selector, alice));
        reg.setTrigger(10_500);
    }

    // ------------------------------------------------------------ active list

    function test_optOut_swapAndPopKeepsIndexes() public {
        address[5] memory users = [alice, bob, makeAddr("c"), makeAddr("d"), makeAddr("e")];
        for (uint256 i; i < users.length; ++i) {
            vm.prank(users[i]);
            reg.optIn(WETH, 10_400, 100);
        }
        vm.prank(bob);
        reg.optOut();
        assertEq(reg.activeCount(), 4);
        address[] memory page = reg.activeBorrowers(0, 10);
        for (uint256 i; i < page.length; ++i) {
            assertEq(reg.record(page[i]).listIndex, i + 1, "list index matches position");
            assertTrue(page[i] != bob);
        }
        assertEq(reg.record(bob).listIndex, 0);
        assertEq(reg.record(bob).flags & reg.FLAG_ACTIVE(), 0);
    }

    function testFuzz_activeList_consistent(uint8[16] memory ops) public {
        address[6] memory users = [alice, bob, makeAddr("c"), makeAddr("d"), makeAddr("e"), makeAddr("f")];
        for (uint256 i; i < ops.length; ++i) {
            address u = users[ops[i] % users.length];
            bool active = reg.record(u).flags & reg.FLAG_ACTIVE() != 0;
            vm.prank(u);
            if (active) reg.optOut();
            else reg.optIn(WETH, 10_400, 100);
        }
        uint256 n = reg.activeCount();
        address[] memory page = reg.activeBorrowers(0, n);
        uint256 counted;
        for (uint256 j; j < users.length; ++j) {
            IPositionRegistry.Record memory r = reg.record(users[j]);
            if (r.flags & reg.FLAG_ACTIVE() != 0) {
                ++counted;
                assertEq(page[r.listIndex - 1], users[j]);
            } else {
                assertEq(r.listIndex, 0);
            }
        }
        assertEq(counted, n);
    }

    function test_activeBorrowers_pagination() public {
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
        vm.prank(bob);
        reg.optIn(WETH, 10_400, 100);
        assertEq(reg.activeBorrowers(1, 5).length, 1);
        assertEq(reg.activeBorrowers(2, 5).length, 0);
        assertEq(reg.activeBorrowers(0, 1)[0], alice);
    }

    // ------------------------------------------------------------ module writes

    function test_moduleWrites_onlyModules() public {
        vm.expectRevert(IPositionRegistry.NotRepricer.selector);
        reg.creditPrepaid(alice, 1);
        vm.expectRevert(IPositionRegistry.NotRepricer.selector);
        reg.debitPrepaid(alice, 1);
        vm.expectRevert(IPositionRegistry.NotRepricer.selector);
        reg.writeRepricerState(alice, 1, 1, 1, 1, 1, false);
        vm.expectRevert(IPositionRegistry.NotExecutor.selector);
        reg.markExited(alice);
    }

    function test_debitToZero_lapsesAndCreditRestores() public {
        vm.prank(repricer);
        reg.creditPrepaid(alice, 10e18);
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
        vm.roll(block.number + 50);
        vm.expectEmit(address(reg));
        emit IPositionRegistry.CoverLapsed(alice);
        vm.prank(repricer);
        reg.debitPrepaid(alice, 10e18);
        assertEq(reg.record(alice).flags & reg.FLAG_LAPSED(), reg.FLAG_LAPSED());
        vm.roll(block.number + 50);
        vm.expectEmit(address(reg));
        emit IPositionRegistry.CoverRestored(alice);
        vm.prank(repricer);
        reg.creditPrepaid(alice, 1e18);
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.flags & reg.FLAG_LAPSED(), 0);
        assertEq(r.lastRepricedBlock, block.number, "restore restarts the accrual clock");
    }

    function test_markExited_closesRecord() public {
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
        vm.prank(repricer);
        reg.writeRepricerState(alice, 5e18, 0, 1e12, 10_390, 0.8e18, false);
        vm.prank(executor);
        reg.markExited(alice);
        IPositionRegistry.Record memory r = reg.record(alice);
        assertEq(r.flags, reg.FLAG_EXITED());
        assertEq(r.premiumPerBlock, 0, "rate cleared");
        assertEq(r.prepaid, 5e18, "unused prepaid stays withdrawable");
        assertEq(reg.activeCount(), 0);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(IPositionRegistry.NotActive.selector, alice));
        reg.markExited(alice);
        // A closed record can opt in again.
        vm.prank(alice);
        reg.optIn(WETH, 10_500, 100);
        assertEq(reg.record(alice).flags, reg.FLAG_ACTIVE());
    }

    // ------------------------------------------------------------ owner

    function test_owner_setters() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        reg.setExitParams(100, 600, 100);
        vm.expectRevert(IPositionRegistry.InvalidParameter.selector);
        reg.setExitParams(0, 600, 100);
        vm.expectRevert(IPositionRegistry.InvalidParameter.selector);
        reg.setExitParams(501, 600, 100);
        reg.setExitParams(150, 800, 50);
        assertEq(reg.exitDiscountBps(), 150);
        // A raised exit discount raises the minimum a new opt-in must accept.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IPositionRegistry.MaxDiscountOutOfRange.selector, uint16(100), uint16(150))
        );
        reg.optIn(WETH, 10_400, 100);
    }

    function test_setModules_once() public {
        vm.expectRevert(IPositionRegistry.ModulesAlreadySet.selector);
        reg.setModules(address(1), address(2));
    }

    function test_setAsset_idsStable() public {
        assertEq(reg.assetConfig(WETH).id, 0);
        assertEq(reg.assetConfig(CBBTC).id, 1);
        reg.setAsset(WETH, bytes32("ETH/USD2"), 0.002e18, 0.7e18, true);
        assertEq(reg.assetConfig(WETH).id, 0);
        assertEq(reg.assets().length, 2);
        vm.expectRevert(IPositionRegistry.InvalidParameter.selector);
        reg.setAsset(address(0), bytes32("x"), 1, 1, true);
    }
}

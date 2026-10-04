// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {PremiumMath} from "../../src/libraries/PremiumMath.sol";
import {MonadAddresses as M} from "../utils/MonadAddresses.sol";
import {ForkBase} from "./ForkBase.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Repricing against the live Pyth contract and real Aave on a Monad mainnet fork.
contract RepricerForkTest is ForkBase {
    function setUp() public override {
        realPyth = true;
        super.setUp();
        _seedVault(10_000e6);
        _openPosition(borrower, 2e18, 10_900); // HF 1.09, trigger 1.04: d = 0.05
        _optIn(borrower, 10_400, 20e6);
    }

    function test_reprice_readsRealPythAndAave() public {
        PythStructs.Price memory live = IPyth(M.PYTH).getPriceUnsafe(M.ETH_USD_FEED);
        assertGt(live.price, 0, "Pyth push feed is live on Monad");
        _nextBlock();
        d.repricer.reprice(borrower, _none());
        (uint16 count,,, uint64 newest,) = d.repricer.volState(M.ETH_USD_FEED);
        assertEq(count, 1, "first observation from the on-chain push feed");
        assertEq(newest, live.publishTime);

        (, uint256 debtBase,,,, uint256 hf) = pool.getUserAccountData(borrower);
        uint256 expected = PremiumMath.perBlock(
            PremiumMath.annualPremium(
                debtBase, hf, 10_400, 100, 0.00125e18, 0.8e18, oracle.getAssetPrice(M.USDC)
            ),
            300
        );
        IPositionRegistry.Record memory r = d.registry.record(borrower);
        assertEq(r.premiumPerBlock, expected);
        assertEq(r.healthFactorBps, hf / 1e14);
    }

    /// @notice Three consecutive blocks, one reprice each: each charges exactly one block at the stored rate.
    function test_reprice_threeConsecutiveBlocks() public {
        _nextBlock();
        d.repricer.reprice(borrower, _none());
        uint256 accrued0 = d.registry.record(borrower).accrued;
        for (uint256 i; i < 3; ++i) {
            uint256 rate = d.registry.record(borrower).premiumPerBlock;
            _nextBlock();
            vm.prank(keeper);
            d.repricer.reprice(borrower, _none());
            if (i == 2) vm.snapshotGasLastCall("reprice_single_warmFeed");
            uint256 accrued = d.registry.record(borrower).accrued;
            assertEq(accrued - accrued0, rate, "one block at the stored rate");
            accrued0 = accrued;
        }
    }

    function test_repriceMany_gas() public {
        address[] memory list = new address[](3);
        list[0] = borrower;
        for (uint256 i = 1; i < 3; ++i) {
            list[i] = makeAddr(string(abi.encode("b", i)));
            _openPosition(list[i], 1e18, 10_900 + i * 100);
            _optIn(list[i], 10_400, 10e6);
        }
        _nextBlock();
        d.repricer.repriceMany(list, _none());
        _nextBlock();
        vm.prank(keeper);
        d.repricer.repriceMany(list, _none());
        vm.snapshotGasLastCall("repriceMany_3_borrowers");
        for (uint256 i; i < 3; ++i) {
            assertGt(d.registry.record(list[i]).accrued, 0);
        }
    }

    function test_topUpAndWithdraw_realUsdc() public {
        uint256 before = usdc.balanceOf(borrower);
        vm.prank(borrower);
        d.repricer.withdrawUnused(5e6);
        assertEq(usdc.balanceOf(borrower) - before, 5e6);
        assertEq(d.registry.record(borrower).prepaid, 15e18);
    }

    function test_premiumReachesVaultNav() public {
        _nextBlock();
        d.repricer.reprice(borrower, _none());
        uint256 navBefore = d.vault.totalAssets();
        vm.roll(block.number + 200_000); // about 17 hours of blocks
        vm.warp(block.timestamp + 60_000);
        d.repricer.reprice(borrower, _none());
        assertGt(d.vault.totalAssets(), navBefore, "premium raises NAV");
        assertEq(d.vault.totalPremiumEarned(), d.vault.totalAssets() - navBefore);
    }
}

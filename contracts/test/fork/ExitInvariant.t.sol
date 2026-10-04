// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ShieldDeployment} from "../../script/ShieldDeployment.sol";
import {MonadAddresses as M} from "../utils/MonadAddresses.sol";
import {FixedPriceAggregator, ForkBase} from "./ForkBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {Test, console2} from "forge-std/Test.sol";

/// @notice Moves the WETH price, borrows, reprices and attempts exits on real Aave in random order, recording
/// the HF before and after every exit that succeeds.
contract ExitHandler is Test {
    ShieldDeployment.Deployed internal d;
    MockPyth internal pyth;
    IPool internal pool = IPool(M.POOL);
    IAaveOracle internal oracle = IAaveOracle(M.AAVE_ORACLE);
    address[] public borrowers;
    uint64 internal pythTime;

    struct ExitRecord {
        uint256 before;
        uint256 afterExit;
    }

    ExitRecord[] public exits;
    uint256 public attempts;

    constructor(ShieldDeployment.Deployed memory d_, MockPyth pyth_, address[] memory borrowers_) {
        d = d_;
        pyth = pyth_;
        borrowers = borrowers_;
        pythTime = uint64(block.timestamp);
    }

    function _hf(address u) internal view returns (uint256 hf) {
        (,,,,, hf) = pool.getUserAccountData(u);
    }

    function movePrice(int256 bps) external {
        bps = bound(bps, -700, 300);
        uint256 price = oracle.getAssetPrice(M.WETH);
        uint256 next = uint256(int256(price) + int256(price) * bps / 10_000);
        FixedPriceAggregator agg = new FixedPriceAggregator(int256(next));
        address[] memory assets = new address[](1);
        address[] memory sources = new address[](1);
        assets[0] = M.WETH;
        sources[0] = address(agg);
        vm.prank(M.ACL_ADMIN);
        oracle.setAssetSources(assets, sources);
        pythTime = uint64(block.timestamp) > pythTime ? uint64(block.timestamp) : pythTime + 1;
        bytes[] memory u = new bytes[](1);
        u[0] = pyth.createPriceFeedUpdateData(
            M.ETH_USD_FEED, int64(int256(next)), 1e6, -8, int64(int256(next)), 1e6, pythTime
        );
        pyth.updatePriceFeeds(u);
    }

    function nextBlock(uint256 n) external {
        n = bound(n, 1, 20);
        vm.roll(block.number + n);
        vm.warp(block.timestamp + 1);
    }

    function reprice() external {
        d.repricer.repriceMany(borrowers, new bytes[](0));
    }

    function exit(uint256 seed) external {
        address u = borrowers[seed % borrowers.length];
        ++attempts;
        uint256 before = _hf(u);
        try d.executor.exit(u, new bytes[](0)) {
            exits.push(ExitRecord(before, _hf(u)));
        } catch {}
    }

    function exitCount() external view returns (uint256) {
        return exits.length;
    }
}

/// @notice The safety invariant of SPEC.md: an exit never leaves HF at or below 1.0 or below the pre-exit HF,
/// and the Executor never keeps funds.
contract ExitInvariantTest is ForkBase {
    ExitHandler internal handler;

    function setUp() public override {
        super.setUp();
        if (address(d.registry) == address(0)) return;
        _seedVault(20_000e6);
        address[] memory list = new address[](3);
        for (uint256 i; i < 3; ++i) {
            list[i] = makeAddr(string(abi.encode("inv", i)));
            _openPosition(list[i], 0.5e18 + i * 0.25e18, 10_800 + i * 300);
            _optIn(list[i], uint32(10_400 + i * 100), 10e6);
        }
        handler = new ExitHandler(d, mockPyth, list);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 6
    /// forge-config: default.invariant.depth = 20
    /// forge-config: ci.invariant.runs = 6
    /// forge-config: ci.invariant.depth = 20
    function invariant_exitNeverLeavesHfAtOrBelowOneOrBelowStart() public view {
        for (uint256 i; i < handler.exitCount(); ++i) {
            (uint256 before, uint256 afterExit) = handler.exits(i);
            assertGt(afterExit, 1e18, "HF after exit above 1.0");
            assertGt(afterExit, before, "HF after exit above HF before");
        }
    }

    /// forge-config: default.invariant.runs = 6
    /// forge-config: default.invariant.depth = 20
    /// forge-config: ci.invariant.runs = 6
    /// forge-config: ci.invariant.depth = 20
    function invariant_executorHoldsNothing() public view {
        assertEq(IERC20(M.USDC).balanceOf(address(d.executor)), 0);
        assertEq(IERC20(M.A_WETH).balanceOf(address(d.executor)), 0);
        assertEq(IERC20(M.WETH).balanceOf(address(d.executor)), 0);
    }

    function afterInvariant() external view {
        // Fail loudly if the handler never managed to exercise an exit across the run.
        assertGt(handler.attempts(), 0);
        console2.log("exit attempts", handler.attempts(), "succeeded", handler.exitCount());
    }
}

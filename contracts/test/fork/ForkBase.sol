// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ShieldDeployment} from "../../script/ShieldDeployment.sol";
import {Executor} from "../../src/Executor.sol";
import {MonadAddresses as M} from "../utils/MonadAddresses.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Test-only Chainlink-style feed the fork tests install as Aave's WETH price source, the way Aave's
/// own pool admin would. It exists only inside a forked test run.
contract FixedPriceAggregator {
    int256 public latestAnswer;

    constructor(int256 answer) {
        latestAnswer = answer;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }
}

interface IACLManagerLike {
    function addPoolAdmin(address admin) external;
}

interface IPoolConfiguratorLike {
    function setReserveFlashLoaning(address asset, bool enabled) external;
}

/// @notice Shared setup for tests against a fork of Monad mainnet: the real Aave V3 Pool, oracle, USDC, WETH and
/// Uniswap V3. Skipped when MONAD_RPC_URL is not set. FORK_BLOCK pins the block (public RPCs keep about
/// 100,000 blocks of state). Pyth is MockPyth by default so tests can move prices; `realPyth` uses the live
/// Pyth contract on the fork.
abstract contract ForkBase is Test {
    IPool internal pool = IPool(M.POOL);
    IAaveOracle internal oracle = IAaveOracle(M.AAVE_ORACLE);
    IERC20 internal usdc = IERC20(M.USDC);
    IERC20 internal weth = IERC20(M.WETH);
    IERC20 internal aWeth = IERC20(M.A_WETH);
    IERC20 internal vUsdc = IERC20(M.V_USDC);

    ShieldDeployment.Deployed internal d;
    MockPyth internal mockPyth;
    address internal borrower = makeAddr("borrower");
    address internal lp = makeAddr("lp");
    address internal keeper = makeAddr("keeper");
    uint64 internal pythTime;
    bool internal realPyth;

    function setUp() public virtual {
        string memory rpc = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);

        ShieldDeployment.Config memory c = ShieldDeployment.monadMainnet(address(this), keeper);
        if (!realPyth) {
            mockPyth = new MockPyth(3600, 0);
            c.pyth = IPyth(address(mockPyth));
            pythTime = uint64(block.timestamp);
            _pushPyth(oracle.getAssetPrice(M.WETH));
        }
        d = ShieldDeployment.deploy(c);
        vm.label(address(d.registry), "PositionRegistry");
        vm.label(address(d.repricer), "Repricer");
        vm.label(address(d.executor), "Executor");
        vm.label(address(d.vault), "ShieldVault");
        vm.label(address(d.swapper), "UniswapV3Swapper");
    }

    // ------------------------------------------------------------ positions

    /// @dev Supplies `wethAmount` for `user` and borrows USDC down to `hfBps` (HF x 1e4). Borrowing alone
    /// cannot go below LT/LTV = 1.0435 for WETH.
    function _openPosition(address user, uint256 wethAmount, uint256 hfBps) internal {
        deal(M.WETH, user, wethAmount);
        vm.startPrank(user);
        weth.approve(address(pool), wethAmount);
        pool.supply(M.WETH, wethAmount, user, 0);
        vm.stopPrank();
        _borrowToHf(user, hfBps);
    }

    function _borrowToHf(address user, uint256 hfBps) internal {
        (uint256 collBase, uint256 debtBase,, uint256 lt,,) = pool.getUserAccountData(user);
        uint256 targetDebtBase = collBase * lt * 1e4 / (hfBps * 1e4);
        require(targetDebtBase > debtBase, "already below target");
        uint256 amount = (targetDebtBase - debtBase) * 1e6 / oracle.getAssetPrice(M.USDC);
        vm.prank(user);
        pool.borrow(M.USDC, amount, 2, 0, user);
    }

    function _hf(address user) internal view returns (uint256 hf) {
        (,,,,, hf) = pool.getUserAccountData(user);
    }

    /// @dev Opt in with a prepaid balance and approve the Executor on aWETH, as the web flow does.
    function _optIn(address user, uint32 trigger, uint256 prepay) internal {
        deal(M.USDC, user, usdc.balanceOf(user) + prepay);
        vm.startPrank(user);
        aWeth.approve(address(d.executor), type(uint256).max);
        usdc.approve(address(d.repricer), prepay);
        d.registry.optIn(M.WETH, trigger, 100);
        d.repricer.topUp(prepay);
        vm.stopPrank();
    }

    function _seedVault(uint256 amount) internal {
        deal(M.USDC, lp, amount);
        vm.startPrank(lp);
        usdc.approve(address(d.vault), amount);
        d.vault.deposit(amount, lp);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ prices

    /// @dev Installs a fixed WETH price as Aave's source (pool admin action on the fork) and, with MockPyth,
    /// publishes the same price to Pyth.
    function _setWethPrice(uint256 price8) internal {
        FixedPriceAggregator agg = new FixedPriceAggregator(int256(price8));
        address[] memory assets = new address[](1);
        address[] memory sources = new address[](1);
        assets[0] = M.WETH;
        sources[0] = address(agg);
        vm.prank(M.ACL_ADMIN);
        oracle.setAssetSources(assets, sources);
        if (!realPyth) _pushPyth(price8);
    }

    function _pushPyth(uint256 price8) internal {
        pythTime = uint64(block.timestamp) > pythTime ? uint64(block.timestamp) : pythTime + 1;
        bytes[] memory u = new bytes[](1);
        u[0] = mockPyth.createPriceFeedUpdateData(
            M.ETH_USD_FEED, int64(int256(price8)), 1e6, -8, int64(int256(price8)), 1e6, pythTime
        );
        mockPyth.updatePriceFeeds(u);
    }

    function _pythUpdateFor(bytes32 feed, uint256 price8) internal returns (bytes[] memory u) {
        pythTime = uint64(block.timestamp) > pythTime ? uint64(block.timestamp) : pythTime + 1;
        u = new bytes[](1);
        u[0] = mockPyth.createPriceFeedUpdateData(
            feed, int64(int256(price8)), 1e6, -8, int64(int256(price8)), 1e6, pythTime
        );
    }

    /// @dev Drops the WETH price until `user`'s HF is at `hfBps`.
    function _dropPriceToHf(address user, uint256 hfBps) internal {
        uint256 hf = _hf(user);
        uint256 price = oracle.getAssetPrice(M.WETH);
        _setWethPrice(price * hfBps * 1e14 / hf);
    }

    function _setFlashLoans(address asset, bool enabled) internal {
        vm.prank(M.ACL_ADMIN);
        IPoolConfiguratorLike(M.POOL_CONFIGURATOR).setReserveFlashLoaning(asset, enabled);
    }

    function _none() internal pure returns (bytes[] memory) {
        return new bytes[](0);
    }

    function _status(address user) internal view returns (Executor.Status s) {
        (s,,,) = d.executor.previewExit(user);
    }

    function _nextBlock() internal {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
    }
}

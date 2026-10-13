// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {TestnetERC20} from "aave-v3-origin/contracts/mocks/testnet-helpers/TestnetERC20.sol";
import {Script, console2} from "forge-std/Script.sol";

interface IRegistry {
    function optIn(address collateral, uint32 trigger, uint16 maxDiscountBps) external;
}

interface IRepricer {
    function topUp(uint256 amount) external;
}

/// @title TestnetDemo
/// @notice Monad testnet staging (ADR-040): the demo's accounts and position on Shield's testnet deployment. Reads
/// deployments/aave-10143.json (testnet/TestnetMarket.s.sol) and deployments/10143.json (script/Deploy.s.sol).
///   seed(), from the market owner (also Shield's owner and treasury): mints test USDC, supplies TESTNET_AAVE_USDC to
///     Aave so it can be borrowed, deposits TESTNET_VAULT_USDC into Shield's vault, mints TESTNET_WETH to
///     TESTNET_BORROWER, and sends gas to TESTNET_BORROWER and TESTNET_KEEPER (TESTNET_BORROWER_MON, TESTNET_KEEPER_MON).
///   open(), from the borrower: supplies the WETH, borrows USDC down to DEMO_HF_BPS, approves the Executor on aWETH and
///     the Repricer on USDC, prepays DEMO_PREPAY and opts in with DEMO_TRIGGER_BPS.
///   borrowTo(), from the borrower: borrows more USDC until the health factor is DEMO_HF_BPS, an ordinary borrower
///     action that crosses the trigger (borrowing alone stops at LT / LTV, 1.0435 for WETH).
contract TestnetDemo is Script {
    function _aave() internal view returns (IPool pool, address weth, address usdc) {
        string memory a = vm.readFile(string.concat(vm.projectRoot(), "/deployments/aave-10143.json"));
        pool = IPool(vm.parseJsonAddress(a, ".Pool"));
        weth = vm.parseJsonAddress(a, ".WETH");
        usdc = vm.parseJsonAddress(a, ".USDC");
    }

    function _shield() internal view returns (IRegistry registry, IRepricer repricer, address executor, IERC4626 vault) {
        string memory s = vm.readFile(string.concat(vm.projectRoot(), "/deployments/10143.json"));
        registry = IRegistry(vm.parseJsonAddress(s, ".PositionRegistry"));
        repricer = IRepricer(vm.parseJsonAddress(s, ".Repricer"));
        executor = vm.parseJsonAddress(s, ".Executor");
        vault = IERC4626(vm.parseJsonAddress(s, ".ShieldVault"));
    }

    function seed() external {
        require(block.chainid == 10_143, "Monad testnet only");
        (IPool pool, address weth, address usdc) = _aave();
        (,,, IERC4626 vault) = _shield();
        address borrower = vm.envAddress("TESTNET_BORROWER");
        address keeper = vm.envAddress("TESTNET_KEEPER");
        uint256 aaveUsdc = vm.envOr("TESTNET_AAVE_USDC", uint256(50_000e6));
        uint256 vaultUsdc = vm.envOr("TESTNET_VAULT_USDC", uint256(5_000e6));

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        TestnetERC20(usdc).mint(me, aaveUsdc + vaultUsdc);
        IERC20(usdc).approve(address(pool), aaveUsdc);
        pool.supply(usdc, aaveUsdc, me, 0);
        IERC20(usdc).approve(address(vault), vaultUsdc);
        vault.deposit(vaultUsdc, me);
        TestnetERC20(weth).mint(borrower, vm.envOr("TESTNET_WETH", uint256(1e18)));
        payable(borrower).transfer(vm.envOr("TESTNET_BORROWER_MON", uint256(0.5 ether)));
        payable(keeper).transfer(vm.envOr("TESTNET_KEEPER_MON", uint256(3 ether)));
        vm.stopBroadcast();
        console2.log("vault USDC", vault.totalAssets());
    }

    function open() external {
        require(block.chainid == 10_143, "Monad testnet only");
        (IPool pool, address weth, address usdc) = _aave();
        (IRegistry registry, IRepricer repricer, address executor,) = _shield();
        uint256 prepay = vm.envOr("DEMO_PREPAY", uint256(5e6));

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        uint256 wethAmount = IERC20(weth).balanceOf(me);
        IERC20(weth).approve(address(pool), wethAmount);
        pool.supply(weth, wethAmount, me, 0);
        _borrowTo(pool, usdc, me, vm.envUint("DEMO_HF_BPS"));
        IERC20(pool.getReserveAToken(weth)).approve(executor, type(uint256).max);
        IERC20(usdc).approve(address(repricer), prepay);
        repricer.topUp(prepay);
        registry.optIn(weth, uint32(vm.envUint("DEMO_TRIGGER_BPS")), uint16(vm.envOr("DEMO_MAX_DISCOUNT_BPS", uint256(100))));
        vm.stopBroadcast();
        _report(pool, me);
    }

    /// @notice From the borrower: supply all its test WETH and borrow USDC down to DEMO_HF_BPS, leaving the cover to
    /// the web app (approvals, fuel and opt-in through the real UI).
    function openLoan() external {
        require(block.chainid == 10_143, "Monad testnet only");
        (IPool pool, address weth, address usdc) = _aave();
        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        uint256 wethAmount = IERC20(weth).balanceOf(me);
        IERC20(weth).approve(address(pool), wethAmount);
        pool.supply(weth, wethAmount, me, 0);
        _borrowTo(pool, usdc, me, vm.envUint("DEMO_HF_BPS"));
        vm.stopBroadcast();
        _report(pool, me);
    }

    function borrowTo() external {
        (IPool pool,, address usdc) = _aave();
        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        _borrowTo(pool, usdc, me, vm.envUint("DEMO_HF_BPS"));
        vm.stopBroadcast();
        _report(pool, me);
    }

    function _borrowTo(IPool pool, address usdc, address me, uint256 hfBps) internal {
        (uint256 collBase, uint256 debtBase,, uint256 lt,,) = pool.getUserAccountData(me);
        uint256 targetDebt = collBase * lt / hfBps;
        require(targetDebt > debtBase, "HF already at or below target");
        uint256 usdcPrice = IAaveOracle(pool.ADDRESSES_PROVIDER().getPriceOracle()).getAssetPrice(usdc);
        pool.borrow(usdc, (targetDebt - debtBase) * 1e6 / usdcPrice, 2, 0, me);
    }

    function _report(IPool pool, address me) internal view {
        (uint256 c, uint256 debt,,,, uint256 hf) = pool.getUserAccountData(me);
        console2.log("borrower", me);
        console2.log("collateral USD x1e8", c);
        console2.log("debt USD x1e8", debt);
        console2.log("health factor x1e18", hf);
    }
}

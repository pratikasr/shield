// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PositionRegistry} from "../src/PositionRegistry.sol";
import {Repricer} from "../src/Repricer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @title DemoPosition
/// @notice The borrower's side of the demo, on Monad mainnet or a fork of it. Each function broadcasts from the
/// borrower's key. Addresses come from the deployment file named by DEPLOYMENT_FILE.
///   open():    supply DEMO_WETH, borrow USDC down to DEMO_HF_BPS, approve the Executor on aWETH, approve the
///              Repricer on USDC, opt in with DEMO_TRIGGER_BPS and DEMO_MAX_DISCOUNT_BPS, prepay DEMO_PREPAY.
///   borrowTo(): borrow more USDC until HF is DEMO_HF_BPS (a real borrower action that moves HF to the trigger;
///              borrowing alone stops at LT/LTV, 1.0435 for WETH).
///   trigger(): move the trigger to DEMO_TRIGGER_BPS.
contract DemoPosition is Script {
    IPool internal constant POOL = IPool(0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef);
    address internal constant WETH = 0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242;
    address internal constant A_WETH = 0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6;
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    function _deployment()
        internal
        view
        returns (PositionRegistry registry, Repricer repricer, address executor)
    {
        string memory json = vm.readFile(vm.envString("DEPLOYMENT_FILE"));
        registry = PositionRegistry(vm.parseJsonAddress(json, ".PositionRegistry"));
        repricer = Repricer(vm.parseJsonAddress(json, ".Repricer"));
        executor = vm.parseJsonAddress(json, ".Executor");
    }

    function open() external {
        (PositionRegistry registry, Repricer repricer, address executor) = _deployment();
        uint256 wethAmount = vm.envUint("DEMO_WETH");
        uint256 hfBps = vm.envUint("DEMO_HF_BPS");
        uint32 trigger = uint32(vm.envUint("DEMO_TRIGGER_BPS"));
        uint16 maxDiscount = uint16(vm.envOr("DEMO_MAX_DISCOUNT_BPS", uint256(100)));
        uint256 prepay = vm.envUint("DEMO_PREPAY");

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        IERC20(WETH).approve(address(POOL), wethAmount);
        POOL.supply(WETH, wethAmount, me, 0);
        _borrowTo(me, hfBps);
        IERC20(A_WETH).approve(executor, type(uint256).max);
        IERC20(USDC).approve(address(repricer), prepay);
        registry.optIn(WETH, trigger, maxDiscount);
        repricer.topUp(prepay);
        vm.stopBroadcast();
        _report(me);
    }

    function borrowTo() external {
        uint256 hfBps = vm.envUint("DEMO_HF_BPS");
        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        _borrowTo(me, hfBps);
        vm.stopBroadcast();
        _report(me);
    }

    function trigger() external {
        (PositionRegistry registry,,) = _deployment();
        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        registry.setTrigger(uint32(vm.envUint("DEMO_TRIGGER_BPS")));
        vm.stopBroadcast();
        _report(me);
    }

    function _borrowTo(address me, uint256 hfBps) internal {
        (uint256 collBase, uint256 debtBase,, uint256 lt,,) = POOL.getUserAccountData(me);
        uint256 targetDebt = collBase * lt / hfBps;
        require(targetDebt > debtBase, "HF already at or below target");
        uint256 usdcPrice = IAaveOracle(POOL.ADDRESSES_PROVIDER().getPriceOracle()).getAssetPrice(USDC);
        uint256 amount = (targetDebt - debtBase) * 1e6 / usdcPrice;
        POOL.borrow(USDC, amount, 2, 0, me);
    }

    function _report(address me) internal view {
        (uint256 c, uint256 debt,,,, uint256 hf) = POOL.getUserAccountData(me);
        console2.log("borrower", me);
        console2.log("collateral USD x1e8", c);
        console2.log("debt USD x1e8", debt);
        console2.log("health factor x1e18", hf);
    }
}

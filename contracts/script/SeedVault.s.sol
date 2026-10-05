// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ShieldVault} from "../src/ShieldVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @title SeedVault
/// @notice An LP deposit of VAULT_SEED USDC units into the ShieldVault named in DEPLOYMENT_FILE.
contract SeedVault is Script {
    function run() external {
        ShieldVault vault =
            ShieldVault(vm.parseJsonAddress(vm.readFile(vm.envString("DEPLOYMENT_FILE")), ".ShieldVault"));
        uint256 amount = vm.envUint("VAULT_SEED");
        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        IERC20(vault.asset()).approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, me);
        vm.stopBroadcast();
        console2.log("deposited", amount, "shares", shares);
        console2.log("vault totalAssets", vault.totalAssets());
    }
}

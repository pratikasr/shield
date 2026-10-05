// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ShieldDeployment} from "./ShieldDeployment.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @title Deploy
/// @notice Deploys Shield to Monad mainnet (or a fork of it) and writes the addresses to
/// deployments/<DEPLOYMENT_NAME>.json (default: the chain id). Run through scripts/deploy-mainnet.sh, which
/// passes the key from the environment. KEEPER_ADDRESS (optional) becomes the vault's unwinder.
contract Deploy is Script {
    function run() external returns (ShieldDeployment.Deployed memory d) {
        address keeper = vm.envOr("KEEPER_ADDRESS", address(0));
        vm.startBroadcast();
        (, address owner,) = vm.readCallers();
        ShieldDeployment.Config memory c = ShieldDeployment.monadMainnet(owner, keeper);
        d = ShieldDeployment.deploy(c);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "block", block.number);
        vm.serializeAddress(key, "owner", owner);
        vm.serializeAddress(key, "PositionRegistry", address(d.registry));
        vm.serializeAddress(key, "ShieldVault", address(d.vault));
        vm.serializeAddress(key, "Repricer", address(d.repricer));
        vm.serializeAddress(key, "Executor", address(d.executor));
        string memory json = vm.serializeAddress(key, "UniswapV3Swapper", address(d.swapper));
        string memory name = vm.envOr("DEPLOYMENT_NAME", vm.toString(block.chainid));
        string memory path = string.concat(vm.projectRoot(), "/deployments/", name, ".json");
        vm.writeJson(json, path);

        console2.log("PositionRegistry", address(d.registry));
        console2.log("ShieldVault", address(d.vault));
        console2.log("Repricer", address(d.repricer));
        console2.log("Executor", address(d.executor));
        console2.log("UniswapV3Swapper", address(d.swapper));
    }
}

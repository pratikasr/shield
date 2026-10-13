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
        // Monad testnet staging (ADR-040): Shield on the Aave V3 market deployed there by testnet/TestnetMarket.s.sol.
        if (block.chainid == 10_143) {
            string memory aave = vm.readFile(
                vm.envOr("AAVE_MARKET_FILE", string.concat(vm.projectRoot(), "/deployments/aave-10143.json"))
            );
            c = ShieldDeployment.monadTestnet(
                owner,
                keeper,
                vm.parseJsonAddress(aave, ".PoolAddressesProvider"),
                vm.parseJsonAddress(aave, ".USDC"),
                vm.parseJsonAddress(aave, ".WETH")
            );
        }
        // Fork rehearsals shorten the waiting period so a scripted run does not sit idle for 15 minutes.
        c.minCoverSeconds = uint32(vm.envOr("SHIELD_MIN_COVER_SECONDS", uint256(c.minCoverSeconds)));
        c.treasury = vm.envOr("SHIELD_TREASURY", c.treasury);
        uint256 share = vm.envOr("SHIELD_PROTOCOL_SHARE_BPS", uint256(c.protocolShareBps));
        require(share <= 2000, "SHIELD_PROTOCOL_SHARE_BPS is above the 2000 bps cap");
        c.protocolShareBps = uint16(share);
        d = ShieldDeployment.deploy(c);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "block", block.number);
        vm.serializeAddress(key, "owner", owner);
        vm.serializeAddress(key, "treasury", c.treasury);
        vm.serializeUint(key, "protocolShareBps", c.protocolShareBps);
        vm.serializeAddress(key, "PositionRegistry", address(d.registry));
        vm.serializeAddress(key, "ShieldVault", address(d.vault));
        vm.serializeAddress(key, "Repricer", address(d.repricer));
        vm.serializeAddress(key, "Executor", address(d.executor));
        vm.serializeAddress(key, "ShieldForwarderFactory", address(d.forwarders));
        string memory json = vm.serializeAddress(key, "UniswapV3Swapper", address(d.swapper));
        string memory name = vm.envOr("DEPLOYMENT_NAME", vm.toString(block.chainid));
        string memory path = string.concat(vm.projectRoot(), "/deployments/", name, ".json");
        vm.writeJson(json, path);

        console2.log("PositionRegistry", address(d.registry));
        console2.log("ShieldVault", address(d.vault));
        console2.log("Repricer", address(d.repricer));
        console2.log("Executor", address(d.executor));
        console2.log("UniswapV3Swapper", address(d.swapper));
        console2.log("ShieldForwarderFactory", address(d.forwarders));
        console2.log("treasury", c.treasury);
        console2.log("protocol share of premiums, bps", c.protocolShareBps);
    }
}

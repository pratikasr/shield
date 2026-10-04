// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Executor} from "../src/Executor.sol";
import {PositionRegistry} from "../src/PositionRegistry.sol";
import {Repricer} from "../src/Repricer.sol";
import {ShieldVault} from "../src/ShieldVault.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Placeholder from M1: the four contracts compile and deploy.
contract ScaffoldTest is Test {
    function test_contractsDeploy() public {
        assertGt(address(new PositionRegistry()).code.length, 0);
        assertGt(address(new Repricer()).code.length, 0);
        assertGt(address(new Executor()).code.length, 0);
        assertGt(address(new ShieldVault()).code.length, 0);
    }
}

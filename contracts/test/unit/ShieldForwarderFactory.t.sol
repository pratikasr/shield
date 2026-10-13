// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {Repricer} from "../../src/Repricer.sol";
import {ShieldForwarder, ShieldForwarderFactory} from "../../src/ShieldForwarderFactory.sol";
import {ShieldVault} from "../../src/ShieldVault.sol";
import {IRepricer} from "../../src/interfaces/IRepricer.sol";
import {MockAaveOracle, MockAavePool} from "../mocks/MockAave.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Deposit-and-execute through per-account forwarders (ADR-039): USDC sent to a borrower's deposit address,
/// by Aurora Intents or a plain transfer, becomes that borrower's prepaid premium; USDC sent to the treasury's
/// deposit address becomes vault shares for the treasury.
contract ShieldForwarderFactoryTest is Test {
    PositionRegistry internal reg;
    Repricer internal rp;
    ShieldVault internal vault;
    ShieldForwarderFactory internal factory;
    MockAavePool internal pool;
    MockAaveOracle internal oracle;
    MockERC20 internal usdc;
    address internal constant WETH = address(0xE7);
    address internal alice = makeAddr("alice");
    address internal treasury = makeAddr("treasury");
    address internal executor = makeAddr("executor");

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pool = new MockAavePool();
        oracle = new MockAaveOracle();
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(WETH, 2700e8);
        pool.setReserve(WETH, address(new MockERC20("Aave WETH", "aWETH", 18)), address(0), 8400, 10_550, 18);
        reg = new PositionRegistry(address(this));
        reg.setAsset(WETH, bytes32("ETH/USD"), 0.00125e18, 0.8e18, true);
        vault = new ShieldVault(
            address(this), IERC20(address(usdc)), IPool(address(pool)), IAaveOracle(address(oracle)), reg
        );
        rp = new Repricer(
            address(this),
            reg,
            IPool(address(pool)),
            IAaveOracle(address(oracle)),
            IPyth(address(new MockPyth(3600, 0))),
            IERC20(address(usdc)),
            vault
        );
        reg.setModules(address(rp), executor);
        vault.setModules(executor, address(rp));
        factory = new ShieldForwarderFactory(IERC20(address(usdc)), rp, IERC4626(address(vault)), reg);
        rp.setTopUpAgent(address(factory));
        reg.setProtocolShare(treasury, 1000);
        vault.setDepositor(treasury, true);
    }

    /// @notice The deposit address exists before its forwarder does, so it can be handed to Aurora at once; the
    /// forwarder is later deployed at exactly that address.
    function test_forwarderFor_isKnownBeforeDeployment() public {
        address predicted = factory.forwarderFor(alice);
        assertEq(predicted.code.length, 0);
        usdc.mint(predicted, 25e6);
        factory.sweepPremium(alice);
        assertGt(predicted.code.length, 0, "deployed at the predicted address");
        assertEq(ShieldForwarder(predicted).factory(), address(factory));
        assertEq(factory.forwarderFor(alice), predicted, "stable after deployment");
    }

    function test_sweepPremium_topsUpTheBorrower() public {
        address forwarder = factory.forwarderFor(alice);
        usdc.mint(forwarder, 25e6);
        vm.expectEmit(true, false, false, true, address(rp));
        emit IRepricer.ToppedUp(alice, 25e6);
        vm.expectEmit(true, true, false, true, address(factory));
        emit ShieldForwarderFactory.PremiumSwept(alice, forwarder, 25e6);
        vm.prank(makeAddr("anyone"));
        assertEq(factory.sweepPremium(alice), 25e6);
        assertEq(reg.record(alice).prepaid, 25e18, "credited in 18-decimal units");
        assertEq(usdc.balanceOf(forwarder), 0);
        assertEq(usdc.balanceOf(address(factory)), 0, "the factory keeps nothing");
        assertEq(usdc.balanceOf(address(rp)), 25e6);
        // A top-up through the forwarder counts for opting in, like the borrower's own top-up.
        pool.setAccount(alice, 13_000e8, 10_000e8, 1.09e18);
        vm.prank(alice);
        reg.optIn(WETH, 10_400, 100);
        assertEq(reg.activeCount(), 1);
    }

    function test_sweepPremium_nothingWaiting_returnsZero() public {
        assertEq(factory.sweepPremium(alice), 0);
        assertEq(reg.record(alice).prepaid, 0);
        assertGt(factory.forwarderFor(alice).code.length, 0, "the forwarder is deployed for next time");
        usdc.mint(factory.forwarderFor(alice), 1);
        assertEq(factory.sweepPremium(alice), 1, "a second sweep uses the deployed forwarder");
    }

    function test_sweepPremium_zeroBorrower_reverts() public {
        vm.expectRevert(ShieldForwarderFactory.ZeroBorrower.selector);
        factory.sweepPremium(address(0));
    }

    /// @notice Only the factory can top up on someone's behalf, and only the factory can empty a forwarder.
    function test_onlyTheFactoryMovesFunds() public {
        usdc.mint(address(this), 5e6);
        usdc.approve(address(rp), 5e6);
        vm.expectRevert(IRepricer.NotTopUpAgent.selector);
        rp.topUpFor(alice, 5e6);

        usdc.mint(factory.forwarderFor(alice), 5e6);
        factory.sweepPremium(alice);
        address forwarder = factory.forwarderFor(alice);
        usdc.mint(forwarder, 7e6);
        vm.expectRevert(ShieldForwarder.NotFactory.selector);
        ShieldForwarder(forwarder).pull(IERC20(address(usdc)), address(this));
        assertEq(usdc.balanceOf(forwarder), 7e6);
    }

    function test_setTopUpAgent_ownerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        rp.setTopUpAgent(alice);
        vm.expectEmit(false, false, false, true, address(rp));
        emit IRepricer.TopUpAgentSet(address(0));
        rp.setTopUpAgent(address(0));
        usdc.mint(factory.forwarderFor(alice), 5e6);
        vm.expectRevert(IRepricer.NotTopUpAgent.selector);
        factory.sweepPremium(alice);
    }

    /// @notice The treasury funds the vault through its own deposit address; the shares go to the registry's treasury.
    function test_sweepVault_depositsForTheTreasury() public {
        address forwarder = factory.treasuryForwarder();
        usdc.mint(forwarder, 500e6);
        uint256 expectedShares = vault.previewDeposit(500e6);
        vm.expectEmit(true, true, false, true, address(factory));
        emit ShieldForwarderFactory.VaultFunded(treasury, forwarder, 500e6, expectedShares);
        (uint256 assets, uint256 shares) = factory.sweepVault();
        assertEq(assets, 500e6);
        assertEq(shares, expectedShares);
        assertEq(vault.balanceOf(treasury), shares);
        assertEq(vault.totalAssets(), 500e6);
        (assets, shares) = factory.sweepVault();
        assertEq(assets + shares, 0, "nothing left to deposit");
    }

    function test_sweepVault_respectsTheAllowlist() public {
        vault.setDepositor(treasury, false);
        usdc.mint(factory.treasuryForwarder(), 500e6);
        vm.expectRevert(
            abi.encodeWithSignature("ERC4626ExceededMaxDeposit(address,uint256,uint256)", treasury, 500e6, 0)
        );
        factory.sweepVault();
        assertEq(usdc.balanceOf(factory.treasuryForwarder()), 500e6, "the USDC waits; nothing is lost");
    }

    function testFuzz_depositAddressesNeverCollide(address borrower) public view {
        vm.assume(borrower != address(0));
        assertTrue(factory.forwarderFor(borrower) != factory.treasuryForwarder());
        assertTrue(factory.forwarderFor(borrower) != borrower);
    }

    function testFuzz_sweepPremium_creditsExactlyWhatArrived(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1e15));
        usdc.mint(factory.forwarderFor(alice), amount);
        assertEq(factory.sweepPremium(alice), amount);
        assertEq(reg.record(alice).prepaid, uint256(amount) * 1e12);
    }
}

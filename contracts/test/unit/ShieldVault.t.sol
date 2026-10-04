// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {ShieldVault} from "../../src/ShieldVault.sol";
import {IShieldVault} from "../../src/interfaces/IShieldVault.sol";
import {MockAaveOracle, MockAavePool} from "../mocks/MockAave.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {Test} from "forge-std/Test.sol";

/// @notice ERC-4626 behaviour, NAV with seized collateral, liquidity limits and module access.
contract ShieldVaultTest is Test {
    ShieldVault internal vault;
    PositionRegistry internal reg;
    MockAavePool internal pool;
    MockAaveOracle internal oracle;
    MockERC20 internal usdc;
    MockERC20 internal aWeth;
    address internal constant WETH = address(0xE7);
    address internal executor = makeAddr("executor");
    address internal repricer = makeAddr("repricer");
    address internal lp = makeAddr("lp");
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        aWeth = new MockERC20("Aave WETH", "aWETH", 18);
        pool = new MockAavePool();
        oracle = new MockAaveOracle();
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(WETH, 2000e8);
        pool.setReserve(WETH, address(aWeth), address(0), 8400, 10_550, 18);
        reg = new PositionRegistry(address(this));
        reg.setAsset(WETH, bytes32("ETH/USD"), 0.00125e18, 0.8e18, true);
        vault = new ShieldVault(
            address(this), IERC20(address(usdc)), IPool(address(pool)), IAaveOracle(address(oracle)), reg
        );
        vault.setModules(executor, repricer);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), amount);
        shares = vault.deposit(amount, who);
        vm.stopPrank();
    }

    function test_depositAndRedeem() public {
        uint256 shares = _deposit(lp, 1000e6);
        assertEq(vault.totalAssets(), 1000e6);
        assertEq(vault.decimals(), 12, "6-decimal asset plus 6-decimal offset");
        vm.prank(lp);
        uint256 out = vault.redeem(shares, lp, lp);
        assertEq(out, 1000e6);
    }

    function test_nav_includesSeizedCollateralAtOracle() public {
        _deposit(lp, 1000e6);
        aWeth.mint(address(vault), 0.5e18); // $1,000 of seized aWETH
        assertEq(vault.totalAssets(), 2000e6);
        oracle.setPrice(WETH, 1800e8);
        assertEq(vault.totalAssets(), 1900e6);
    }

    function test_withdrawCappedByIdleUsdc() public {
        _deposit(lp, 1000e6);
        vm.prank(executor);
        vault.fundExit(800e6);
        aWeth.mint(address(vault), 0.404e18); // the exit returns $808 of collateral
        assertEq(vault.availableLiquidity(), 200e6);
        assertEq(vault.maxWithdraw(lp), 200e6);
        assertLe(vault.convertToAssets(vault.maxRedeem(lp)), 200e6);
        vm.prank(lp);
        vm.expectRevert();
        vault.withdraw(201e6, lp, lp);
        vm.prank(lp);
        vault.withdraw(200e6, lp, lp);
    }

    function test_fundExit_onlyExecutorAndWithinLiquidity() public {
        _deposit(lp, 100e6);
        vm.expectRevert(IShieldVault.NotExecutor.selector);
        vault.fundExit(1);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(IShieldVault.InsufficientLiquidity.selector, 101e6, 100e6));
        vault.fundExit(101e6);
    }

    function test_recordExit_stats() public {
        vm.startPrank(executor);
        vault.recordExit(WETH, 0.505e18, 1000e6, 1010e6);
        vault.recordExit(WETH, 0.2525e18, 500e6, 505e6);
        vm.stopPrank();
        assertEq(vault.exitsExecuted(), 2);
        assertEq(vault.totalExitFunding(), 1500e6);
        assertEq(vault.averageDiscountBps(), 100);
        vm.expectRevert(IShieldVault.NotExecutor.selector);
        vault.recordExit(WETH, 1, 1, 1);
    }

    function test_notifyPremium() public {
        usdc.mint(address(vault), 5e6);
        vm.prank(repricer);
        vault.notifyPremium(5e6);
        assertEq(vault.totalPremiumEarned(), 5e6);
        assertEq(vault.totalAssets(), 5e6);
    }

    /// @notice First-depositor inflation attack: a 1-unit deposit plus a large donation must not let the
    /// attacker take a meaningful share of the next deposit.
    function test_inflationAttack_uneconomic() public {
        _deposit(attacker, 1);
        usdc.mint(attacker, 10_000e6);
        vm.prank(attacker);
        usdc.transfer(address(vault), 10_000e6);
        uint256 victimShares = _deposit(lp, 1000e6);
        assertGt(victimShares, 0);
        vm.prank(lp);
        uint256 back = vault.redeem(victimShares, lp, lp);
        assertGe(back, 999e6, "victim keeps at least 99.9% of the deposit");
    }

    function test_setModules_once_andOwnerOnly() public {
        vm.expectRevert(IShieldVault.ModulesAlreadySet.selector);
        vault.setModules(address(1), address(2));
        vm.prank(lp);
        vm.expectRevert();
        vault.setUnwinder(lp);
    }

    function test_unwind_onlyUnwinderOrOwner() public {
        vm.prank(lp);
        vm.expectRevert(IShieldVault.NotUnwinder.selector);
        vault.unwind(WETH, 1, 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {Repricer} from "../../src/Repricer.sol";
import {ShieldVault} from "../../src/ShieldVault.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {MockAaveOracle, MockAavePool} from "../mocks/MockAave.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";
import {StdInvariant, Test} from "forge-std/Test.sol";

/// @notice Drives opt-ins, top-ups, withdrawals, HF moves, Pyth prices and repricing in random order.
contract AccountingHandler is Test {
    PositionRegistry internal reg;
    Repricer internal rp;
    MockAavePool internal pool;
    MockPyth internal pyth;
    MockERC20 internal usdc;
    address internal constant WETH = address(0xE7);
    bytes32 internal constant FEED = bytes32("ETH/USD");
    address[] public users;
    uint64 internal pythTime = 1_790_000_000;

    uint256 public ghostToppedUp;
    uint256 public ghostWithdrawn;

    constructor(PositionRegistry reg_, Repricer rp_, MockAavePool pool_, MockPyth pyth_, MockERC20 usdc_) {
        reg = reg_;
        rp = rp_;
        pool = pool_;
        pyth = pyth_;
        usdc = usdc_;
        for (uint256 i; i < 4; ++i) {
            address u = makeAddr(string(abi.encode("user", i)));
            users.push(u);
            usdc.mint(u, 1_000_000e6);
            vm.prank(u);
            usdc.approve(address(rp), type(uint256).max);
            pool.setAccount(u, 13_000e8, 10_000e8 * (i + 1), 1.06e18 + i * 0.02e18);
        }
    }

    function _user(uint256 seed) internal view returns (address) {
        return users[seed % users.length];
    }

    function optIn(uint256 seed, uint32 trigger) external {
        address u = _user(seed);
        if (reg.record(u).flags & reg.FLAG_ACTIVE() != 0) return;
        trigger = uint32(bound(trigger, 10_100, 12_000));
        vm.prank(u);
        reg.optIn(WETH, trigger, 100);
    }

    function optOut(uint256 seed) external {
        address u = _user(seed);
        if (reg.record(u).flags & reg.FLAG_ACTIVE() == 0) return;
        vm.prank(u);
        reg.optOut();
    }

    function topUp(uint256 seed, uint256 amount) external {
        amount = bound(amount, 1, 50_000e6);
        vm.prank(_user(seed));
        rp.topUp(amount);
        ghostToppedUp += amount;
    }

    function withdraw(uint256 seed, uint256 amount) external {
        address u = _user(seed);
        IPositionRegistry.Record memory r = reg.record(u);
        uint256 max = r.prepaid / 1e12;
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(u);
        try rp.withdrawUnused(amount) {
            ghostWithdrawn += amount;
        } catch {}
    }

    function moveHealth(uint256 seed, uint256 hf, uint256 debt) external {
        hf = bound(hf, 0.9e18, 3e18);
        debt = bound(debt, 0, 5_000_000e8);
        pool.setAccount(_user(seed), 13_000e8, debt, hf);
    }

    function samplePrice(int64 bps) external {
        bps = int64(bound(bps, -300, 300));
        pythTime += 1;
        vm.warp(pythTime);
        bytes[] memory u = new bytes[](1);
        int64 price = int64(2700e8) + int64(2700e8) * bps / 10_000;
        u[0] = pyth.createPriceFeedUpdateData(FEED, price, 1e6, -8, price, 1e6, pythTime);
        rp.repriceMany(new address[](0), u);
    }

    function advance(uint256 blocks) external {
        vm.roll(block.number + bound(blocks, 1, 50_000));
    }

    function repriceAll() external {
        rp.repriceMany(users, new bytes[](0));
    }

    function repriceOne(uint256 seed) external {
        address u = _user(seed);
        if (reg.record(u).flags & reg.FLAG_ACTIVE() == 0) return;
        rp.reprice(u, new bytes[](0));
    }

    function usersLength() external view returns (uint256) {
        return users.length;
    }
}

/// @notice Money is never created or lost between the borrower, the Repricer and the vault.
contract AccountingInvariantTest is StdInvariant, Test {
    PositionRegistry internal reg;
    Repricer internal rp;
    ShieldVault internal vault;
    MockAavePool internal pool;
    MockAaveOracle internal oracle;
    MockPyth internal pyth;
    MockERC20 internal usdc;
    AccountingHandler internal handler;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pool = new MockAavePool();
        oracle = new MockAaveOracle();
        oracle.setPrice(address(usdc), 1e8);
        pyth = new MockPyth(3600, 0);
        reg = new PositionRegistry(address(this));
        reg.setAsset(address(0xE7), bytes32("ETH/USD"), 0.00125e18, 0.8e18, true);
        vault = new ShieldVault(
            address(this), IERC20(address(usdc)), IPool(address(pool)), IAaveOracle(address(oracle)), reg
        );
        rp = new Repricer(
            address(this),
            reg,
            IPool(address(pool)),
            IAaveOracle(address(oracle)),
            IPyth(address(pyth)),
            IERC20(address(usdc)),
            vault
        );
        reg.setModules(address(rp), makeAddr("executor"));
        vault.setModules(makeAddr("executor"), address(rp));
        handler = new AccountingHandler(reg, rp, pool, pyth, usdc);
        targetContract(address(handler));
    }

    /// @notice The Repricer holds exactly the prepaid balances plus premium not yet forwarded.
    function invariant_repricerBalanceMatchesLedger() public view {
        uint256 prepaid;
        for (uint256 i; i < handler.usersLength(); ++i) {
            prepaid += reg.record(handler.users(i)).prepaid;
        }
        assertEq(usdc.balanceOf(address(rp)) * 1e12, prepaid + rp.pendingToVault());
    }

    /// @notice Every unit that left a borrower is either still prepaid, forwarded to the vault, or pending.
    function invariant_conservation() public view {
        uint256 prepaid;
        uint256 accrued;
        for (uint256 i; i < handler.usersLength(); ++i) {
            IPositionRegistry.Record memory r = reg.record(handler.users(i));
            prepaid += r.prepaid;
            accrued += r.accrued;
        }
        assertEq(prepaid + accrued, (handler.ghostToppedUp() - handler.ghostWithdrawn()) * 1e12);
        assertEq(accrued, vault.totalPremiumEarned() * 1e12 + rp.pendingToVault());
        assertEq(usdc.balanceOf(address(vault)), vault.totalPremiumEarned());
    }

    /// @notice Sigma always lands in its clamp once realised, or equals the fallback.
    function invariant_sigmaBounded() public view {
        uint256 s = rp.sigmaOf(bytes32("ETH/USD"), 0.8e18);
        assertTrue(s == 0.8e18 || (s >= rp.SIGMA_MIN() && s <= rp.SIGMA_MAX()));
    }
}

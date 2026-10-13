// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IRepricer} from "./interfaces/IRepricer.sol";
import {IShieldVault} from "./interfaces/IShieldVault.sol";
import {ISwapper} from "./interfaces/ISwapper.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAaveOracle} from "aave-v3-origin/contracts/interfaces/IAaveOracle.sol";
import {IPool} from "aave-v3-origin/contracts/interfaces/IPool.sol";

/// @title ShieldVault
/// @notice ERC-4626 vault in USDC. LPs fund exits and earn the per-block premium stream plus the exit discount.
/// Seized collateral is held as Aave aTokens (earning supply yield) and valued at Aave's oracle until the
/// unwinder swaps it back to USDC within a slippage bound (ADR-024).
/// @dev Withdrawals are limited to idle USDC: seized collateral counts toward NAV but cannot be withdrawn
/// until it is unwound. A 6-decimal virtual share offset makes a first-depositor inflation attack uneconomic.
contract ShieldVault is IShieldVault, ERC4626, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IPool public immutable pool;
    IAaveOracle public immutable oracle;
    IPositionRegistry public immutable registry;
    uint256 private immutable assetUnit;

    address public executor;
    address public repricer;
    address public unwinder;
    ISwapper public swapper;
    uint16 public maxSwapSlippageBps = 300;

    /// @notice Exit gains reach the share price gradually over this period, so a deposit made just before an
    /// exit and redeemed just after cannot take the discount owed to the LPs who carried the cover (audit F3).
    uint256 public constant PROFIT_UNLOCK_SECONDS = 6 hours;
    uint256 private lockedProfitAtLock;
    uint64 private profitLockedAt;

    /// @notice Premium received from the Repricer, in USDC units.
    uint256 public totalPremiumEarned;
    /// @notice Exits this vault has taken part in.
    uint256 public exitsExecuted;
    /// @notice USDC the vault paid into exits.
    uint256 public totalExitFunding;
    /// @notice Oracle value, in USDC units at exit time, of the collateral the vault kept from exits.
    uint256 public totalCollateralValueReceived;
    /// @notice Debt repaid at exits funded entirely by the vault, and the collateral value received for it,
    /// in USDC units. Their ratio is the average discount captured.
    uint256 public discountBaseRepaid;
    uint256 public discountBaseValue;

    /// @notice Accounts that may receive vault shares from a deposit or mint (ADR-039). At launch only the protocol
    /// treasury: the vault is protocol-funded and keeps 100% of its income. Outside liquidity providers are enabled
    /// later by adding them, with no redeploy. Withdrawals are never restricted.
    mapping(address account => bool) public depositorAllowed;

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(address owner_, IERC20 asset_, IPool pool_, IAaveOracle oracle_, IPositionRegistry registry_)
        ERC4626(asset_)
        ERC20("Shield Vault USDC", "shUSDC")
        Ownable(owner_)
    {
        pool = pool_;
        oracle = oracle_;
        registry = registry_;
        assetUnit = 10 ** IERC20Metadata(address(asset_)).decimals();
    }

    // ---------------------------------------------------------------- ERC-4626

    /// @notice Idle USDC plus every seized aToken balance valued at Aave's oracle, in USDC units, less exit
    /// gains that are still unlocking.
    function totalAssets() public view override returns (uint256) {
        uint256 gross = grossAssets();
        uint256 locked = lockedProfit();
        return gross > locked ? gross - locked : 0;
    }

    /// @notice Exit gains not yet in the share price; they unlock linearly over PROFIT_UNLOCK_SECONDS.
    function lockedProfit() public view returns (uint256) {
        uint256 elapsed = block.timestamp - profitLockedAt;
        if (elapsed >= PROFIT_UNLOCK_SECONDS) return 0;
        return Math.mulDiv(lockedProfitAtLock, PROFIT_UNLOCK_SECONDS - elapsed, PROFIT_UNLOCK_SECONDS);
    }

    /// @notice Idle USDC plus every seized aToken balance valued at Aave's oracle, in USDC units.
    function grossAssets() public view returns (uint256 total) {
        total = availableLiquidity();
        address[] memory collaterals = registry.assets();
        if (collaterals.length == 0) return total;
        address usdc = asset();
        uint256 assetPrice = oracle.getAssetPrice(usdc);
        for (uint256 i; i < collaterals.length; ++i) {
            address aToken = pool.getReserveAToken(collaterals[i]);
            if (aToken == address(0)) continue;
            uint256 bal = IERC20(aToken).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 unit = 10 ** ((pool.getConfiguration(collaterals[i]).data >> 48) & 0xff);
            uint256 valueBase = Math.mulDiv(bal, oracle.getAssetPrice(collaterals[i]), unit);
            total += Math.mulDiv(valueBase, assetUnit, assetPrice);
        }
    }

    /// @notice Zero for a receiver not on the depositor allowlist, so ERC-4626 `deposit` reverts for it.
    function maxDeposit(address receiver) public view override returns (uint256) {
        return depositorAllowed[receiver] ? super.maxDeposit(receiver) : 0;
    }

    /// @notice Zero for a receiver not on the depositor allowlist, so ERC-4626 `mint` reverts for it.
    function maxMint(address receiver) public view override returns (uint256) {
        return depositorAllowed[receiver] ? super.maxMint(receiver) : 0;
    }

    /// @notice Withdrawals are capped by idle USDC.
    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(previewRedeem(balanceOf(owner)), availableLiquidity());
    }

    /// @notice Redemptions are capped by idle USDC.
    function maxRedeem(address owner) public view override returns (uint256) {
        return Math.min(balanceOf(owner), _convertToShares(availableLiquidity(), Math.Rounding.Floor));
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @dev Pull accrued premium in before paying out, so withdrawals can use it.
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        _sweepPremium();
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _sweepPremium() private {
        if (repricer != address(0) && IRepricer(repricer).pendingPremium() != 0) IRepricer(repricer).sweep();
    }

    // ---------------------------------------------------------------- module hooks

    /// @notice USDC the vault can pay out now: its balance plus premium accrued at the Repricer, which the vault
    /// sweeps in before any payment.
    function availableLiquidity() public view returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (repricer != address(0)) idle += IRepricer(repricer).pendingPremium();
        return idle;
    }

    /// @notice Premium earned so far, swept or not, in USDC units.
    function premiumEarned() external view returns (uint256) {
        uint256 earned = totalPremiumEarned;
        if (repricer != address(0)) earned += IRepricer(repricer).pendingPremium();
        return earned;
    }

    /// @inheritdoc IShieldVault
    function fundExit(uint256 amount) external onlyExecutor {
        _sweepPremium();
        uint256 idle = availableLiquidity();
        if (amount > idle) revert InsufficientLiquidity(amount, idle);
        IERC20(asset()).safeTransfer(executor, amount);
        emit ExitFunded(amount);
    }

    /// @inheritdoc IShieldVault
    function recordExit(
        address collateral,
        uint256 aTokenAmount,
        uint256 usdcSpent,
        uint256 valueUsdc,
        bool flashFunded
    ) external onlyExecutor {
        ++exitsExecuted;
        totalExitFunding += usdcSpent;
        totalCollateralValueReceived += valueUsdc;
        // The average discount counts only exits the vault funded alone (audit L-4).
        if (!flashFunded && usdcSpent != 0) {
            discountBaseRepaid += usdcSpent;
            discountBaseValue += valueUsdc;
        }
        if (valueUsdc > usdcSpent) {
            lockedProfitAtLock = lockedProfit() + (valueUsdc - usdcSpent);
            profitLockedAt = uint64(block.timestamp);
        }
        emit CollateralReceived(collateral, aTokenAmount, usdcSpent, valueUsdc);
    }

    /// @inheritdoc IShieldVault
    function notifyPremium(uint256 amount) external {
        if (msg.sender != repricer) revert NotRepricer();
        totalPremiumEarned += amount;
        emit PremiumReceived(amount);
    }

    // ---------------------------------------------------------------- unwinding

    /// @notice Swap `amountIn` of seized `collateral` back to USDC. The output must clear both `minOut` and
    /// the oracle value less maxSwapSlippageBps.
    function unwind(address collateral, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (msg.sender != unwinder && msg.sender != owner()) revert NotUnwinder();
        if (address(swapper) == address(0) || amountIn == 0) revert InvalidParameter();
        address usdc = asset();
        uint256 withdrawn = pool.withdraw(collateral, amountIn, address(this));
        uint256 unit = 10 ** ((pool.getConfiguration(collateral).data >> 48) & 0xff);
        uint256 valueBase = Math.mulDiv(withdrawn, oracle.getAssetPrice(collateral), unit);
        uint256 fair = Math.mulDiv(valueBase, assetUnit, oracle.getAssetPrice(usdc));
        uint256 floor = Math.mulDiv(fair, BPS - maxSwapSlippageBps, BPS);
        if (minOut < floor) minOut = floor;
        uint256 usdcBefore = IERC20(usdc).balanceOf(address(this));
        IERC20(collateral).forceApprove(address(swapper), withdrawn);
        swapper.swapExactIn(collateral, usdc, withdrawn, minOut, address(this));
        IERC20(collateral).forceApprove(address(swapper), 0);
        // Trust balances, not the swapper's return value (audit F1).
        amountOut = IERC20(usdc).balanceOf(address(this)) - usdcBefore;
        if (amountOut < minOut) revert SwapBelowMinimum(amountOut, minOut);
        // Collateral the swapper did not take goes back to Aave, where the share price counts it.
        uint256 unsold = IERC20(collateral).balanceOf(address(this));
        if (unsold != 0) {
            IERC20(collateral).forceApprove(address(pool), unsold);
            pool.supply(collateral, unsold, address(this), 0);
        }
        emit Unwound(collateral, withdrawn - unsold, amountOut);
    }

    // ---------------------------------------------------------------- owner

    function setModules(address executor_, address repricer_) external onlyOwner {
        if (executor != address(0) || repricer != address(0)) revert ModulesAlreadySet();
        if (executor_ == address(0) || repricer_ == address(0)) revert InvalidParameter();
        executor = executor_;
        repricer = repricer_;
        emit ModulesSet(executor_, repricer_);
    }

    /// @notice Adds or removes an account that may receive shares from a deposit (ADR-039).
    function setDepositor(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidParameter();
        depositorAllowed[account] = allowed;
        emit DepositorSet(account, allowed);
    }

    function setUnwinder(address unwinder_) external onlyOwner {
        unwinder = unwinder_;
        emit UnwinderSet(unwinder_);
    }

    function setSwapper(ISwapper swapper_, uint16 maxSwapSlippageBps_) external onlyOwner {
        if (maxSwapSlippageBps_ > 1000) revert InvalidParameter();
        swapper = swapper_;
        maxSwapSlippageBps = maxSwapSlippageBps_;
        emit SwapperSet(address(swapper_), maxSwapSlippageBps_);
    }

    // ---------------------------------------------------------------- views for the dashboard

    /// @notice Average discount captured on vault-funded exits, in bps (100 = 1%).
    function averageDiscountBps() external view returns (uint256) {
        if (discountBaseRepaid == 0) return 0;
        return Math.mulDiv(discountBaseValue - discountBaseRepaid, BPS, discountBaseRepaid);
    }
}

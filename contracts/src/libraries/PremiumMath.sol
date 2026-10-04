// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PremiumMath
/// @notice The Shield premium formula, p = k * sigma * V / max(d, d_min) * dt (docs/SPEC.md, ADR-022).
/// @dev Units: debt in Aave base currency (USD x 1e8), prices x 1e8, HF x 1e18, k and sigma x 1e18,
/// results in 18-decimal units of the vault asset.
library PremiumMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR_SECONDS = 31_536_000;
    /// @dev HF x 1e4 to HF x 1e18.
    uint256 internal constant BPS_TO_WAD = 1e14;

    /// @notice Annual premium for covering `debtBase`, in 18-decimal vault-asset units. Zero when there is no
    /// debt or HF is at or below the trigger (the exit is due; no premium is charged).
    /// @param debtBase Total debt from `getUserAccountData`, USD x 1e8.
    /// @param healthFactor HF x 1e18.
    /// @param triggerBps Trigger, HF x 1e4.
    /// @param dMinBps Distance floor, HF x 1e4.
    /// @param k Pricing constant x 1e18.
    /// @param sigma Annualised volatility x 1e18.
    /// @param assetPriceBase Price of one vault-asset unit in base currency (USD x 1e8).
    function annualPremium(
        uint256 debtBase,
        uint256 healthFactor,
        uint256 triggerBps,
        uint256 dMinBps,
        uint256 k,
        uint256 sigma,
        uint256 assetPriceBase
    ) internal pure returns (uint256) {
        if (debtBase == 0 || assetPriceBase == 0) return 0;
        uint256 trigger = triggerBps * BPS_TO_WAD;
        if (healthFactor <= trigger) return 0;
        uint256 d = healthFactor - trigger;
        uint256 dMin = dMinBps * BPS_TO_WAD;
        if (d < dMin) d = dMin;
        // Covered debt in 18-decimal vault-asset units.
        uint256 covered = Math.mulDiv(debtBase, WAD, assetPriceBase);
        return Math.mulDiv(Math.mulDiv(covered, k, WAD), sigma, d);
    }

    /// @notice Per-block premium from an annual premium, for a block time in milliseconds.
    function perBlock(uint256 annual, uint256 blockTimeMs) internal pure returns (uint256) {
        return Math.mulDiv(annual, blockTimeMs, 1000 * YEAR_SECONDS);
    }

    /// @notice Squared simple return between two prices, x 1e18.
    function squaredReturn(uint256 prev, uint256 next) internal pure returns (uint256) {
        uint256 diff = next > prev ? next - prev : prev - next;
        uint256 r = Math.mulDiv(diff, WAD, prev);
        return Math.mulDiv(r, r, WAD);
    }

    /// @notice Annualised volatility x 1e18 from a sum of squared returns observed over `elapsed` seconds.
    function annualisedSigma(uint256 sumSquares, uint256 elapsed) internal pure returns (uint256) {
        if (elapsed == 0) return 0;
        uint256 annualVariance = Math.mulDiv(sumSquares, YEAR_SECONDS, elapsed);
        return Math.sqrt(annualVariance * WAD);
    }
}

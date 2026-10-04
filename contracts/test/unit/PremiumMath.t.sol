// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {PremiumMath} from "../../src/libraries/PremiumMath.sol";
import {Test} from "forge-std/Test.sol";

contract PremiumMathHarness {
    function annualPremium(
        uint256 debtBase,
        uint256 hf,
        uint256 triggerBps,
        uint256 dMinBps,
        uint256 k,
        uint256 sigma,
        uint256 price
    ) external pure returns (uint256) {
        return PremiumMath.annualPremium(debtBase, hf, triggerBps, dMinBps, k, sigma, price);
    }

    function perBlock(uint256 annual, uint256 blockTimeMs) external pure returns (uint256) {
        return PremiumMath.perBlock(annual, blockTimeMs);
    }

    function squaredReturn(uint256 a, uint256 b) external pure returns (uint256) {
        return PremiumMath.squaredReturn(a, b);
    }

    function annualisedSigma(uint256 sumSq, uint256 elapsed) external pure returns (uint256) {
        return PremiumMath.annualisedSigma(sumSq, elapsed);
    }
}

/// @notice The premium formula and the calibration of k (ADR-022).
contract PremiumMathTest is Test {
    PremiumMathHarness internal m;

    /// @dev The calibrated k: 0.02 = k * 0.80 / 0.05.
    uint256 internal constant K = 0.00125e18;
    uint256 internal constant ONE_USD = 1e8;

    function setUp() public {
        m = new PremiumMathHarness();
    }

    /// @notice Calibration: d = 0.05, sigma = 80%, any debt size: the annual premium is 2% of covered debt.
    /// The same k serves WETH and cbBTC because sigma already carries each asset's own volatility.
    function test_calibration_kGivesTwoPercentAtD5Sigma80() public view {
        uint256 trigger = 10_400;
        uint256 hf = 1.09e18; // d = 1.09 - 1.04 = 0.05
        uint256[3] memory debts = [uint256(1000e8), 10_000e8, 1_000_000e8];
        for (uint256 i; i < debts.length; ++i) {
            uint256 annual = m.annualPremium(debts[i], hf, trigger, 100, K, 0.8e18, ONE_USD);
            uint256 covered = debts[i] * 1e10; // USD x 1e8 to 18-decimal USDC at $1
            assertEq(annual, covered * 2 / 100, "2% of covered debt per year");
        }
    }

    function test_calibration_kValueIsPublished() public pure {
        // k = target premium x d / sigma = 0.02 x 0.05 / 0.80
        assertEq(uint256(0.02e18) * 0.05e18 / 0.8e18, K);
    }

    function test_perBlock_300msBlocks() public view {
        // $10,000 at 2% a year is $200 a year; 300 ms blocks give 105,120,000 blocks a year.
        uint256 annual = 200e18;
        uint256 p = m.perBlock(annual, 300);
        assertEq(p, annual * 300 / (1000 * 31_536_000));
        assertApproxEqRel(p * 105_120_000, annual, 1e9);
    }

    function test_distanceFloor_boundsPremium() public view {
        uint256 atFloor = m.annualPremium(10_000e8, 1.05e18, 10_400, 100, K, 0.8e18, ONE_USD); // d = 0.01
        uint256 belowFloor = m.annualPremium(10_000e8, 1.045e18, 10_400, 100, K, 0.8e18, ONE_USD); // d = 0.005
        assertEq(atFloor, belowFloor, "d below d_min is priced at d_min");
        // At d_min the premium is 5x the d = 0.05 premium.
        uint256 at5 = m.annualPremium(10_000e8, 1.09e18, 10_400, 100, K, 0.8e18, ONE_USD);
        assertEq(atFloor, at5 * 5);
    }

    function test_zero_whenAtOrBelowTrigger() public view {
        assertEq(m.annualPremium(10_000e8, 1.04e18, 10_400, 100, K, 0.8e18, ONE_USD), 0);
        assertEq(m.annualPremium(10_000e8, 1.0e18, 10_400, 100, K, 0.8e18, ONE_USD), 0);
    }

    function test_zero_whenNoDebt() public view {
        assertEq(m.annualPremium(0, type(uint256).max, 10_400, 100, K, 0.8e18, ONE_USD), 0);
    }

    function test_usesAssetPrice() public view {
        uint256 atPar = m.annualPremium(10_000e8, 1.09e18, 10_400, 100, K, 0.8e18, 1e8);
        uint256 belowPar = m.annualPremium(10_000e8, 1.09e18, 10_400, 100, K, 0.8e18, 0.5e8);
        assertEq(belowPar, atPar * 2, "covered debt is counted in vault-asset units");
    }

    function testFuzz_monotonic(uint256 debt, uint256 hfExtra, uint256 sigma, uint256 kk) public view {
        debt = bound(debt, 1e8, 1e9 * 1e8); // $1 to $1bn
        hfExtra = bound(hfExtra, 1, 1e18);
        sigma = bound(sigma, 0.1e18, 5e18);
        kk = bound(kk, 1e12, 1e17);
        uint256 hf = 1.04e18 + hfExtra;
        uint256 p = m.annualPremium(debt, hf, 10_400, 100, kk, sigma, ONE_USD);
        // Further from the trigger never costs more.
        assertLe(m.annualPremium(debt, hf + 0.01e18, 10_400, 100, kk, sigma, ONE_USD), p);
        // More volatility and more debt never cost less.
        assertGe(m.annualPremium(debt, hf, 10_400, 100, kk, sigma + 0.1e18, ONE_USD), p);
        assertGe(m.annualPremium(debt + 1e8, hf, 10_400, 100, kk, sigma, ONE_USD), p);
        // Bounded by the d_min ceiling.
        assertLe(p, debt * 1e10 * kk / 1e18 * sigma / 0.01e18 + 1);
    }

    function test_squaredReturn() public view {
        assertEq(m.squaredReturn(100e8, 101e8), 0.0001e18); // 1% move
        assertEq(m.squaredReturn(101e8, 100e8), m.squaredReturn(101e8, 100e8));
        assertEq(m.squaredReturn(100e8, 100e8), 0);
    }

    function test_annualisedSigma_knownSeries() public view {
        // One 1% move per second for 100 seconds: variance 1e-4 per second, annual variance 3153.6,
        // sigma = sqrt(3153.6) = 56.157...
        uint256 sumSq = 100 * 0.0001e18;
        uint256 sigma = m.annualisedSigma(sumSq, 100);
        assertApproxEqRel(sigma, 56.157e18, 1e14);
        // An 80% annual volatility: variance per second = 0.64 / 31,536,000.
        uint256 perSecond = uint256(0.64e18) / 31_536_000;
        assertApproxEqRel(m.annualisedSigma(perSecond * 600, 600), 0.8e18, 1e12);
    }
}

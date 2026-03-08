// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/lib/GaussianMath.sol";

contract GaussianMathTest is Test {
    uint256 constant WAD = 1e18;

    // ═══════════════════════════════ expNeg TESTS ═══════════════════════════════

    function test_expNeg_zero() public pure {
        assertEq(GaussianMath.expNeg(0), WAD); // exp(0) = 1
    }

    function test_expNeg_one() public pure {
        uint256 result = GaussianMath.expNeg(WAD);
        // exp(-1) ≈ 0.367879441171...
        uint256 expected = 367_879_441_171_442_322;
        assertApproxEqRel(result, expected, 1e15); // 0.1% tolerance
    }

    function test_expNeg_two() public pure {
        uint256 result = GaussianMath.expNeg(2 * WAD);
        // exp(-2) ≈ 0.135335283236...
        // 6th-order Taylor reciprocal has ~0.5% error at x=2 (acceptable, weights are normalized)
        uint256 expected = 135_335_283_236_612_692;
        assertApproxEqRel(result, expected, 5e15); // 0.5% tolerance
    }

    function test_expNeg_half() public pure {
        uint256 result = GaussianMath.expNeg(WAD / 2);
        // exp(-0.5) ≈ 0.606530659712...
        uint256 expected = 606_530_659_712_633_424;
        assertApproxEqRel(result, expected, 1e15);
    }

    function test_expNeg_large() public pure {
        // exp(-8) and beyond should return 0
        assertEq(GaussianMath.expNeg(8 * WAD), 0);
        assertEq(GaussianMath.expNeg(100 * WAD), 0);
    }

    // ═══════════════════════════════ gaussianWeight TESTS ═══════════════════════════════

    function test_gaussianWeight_atCenter() public pure {
        // distance = 0, any sigma -> weight = exp(0) = 1.0
        uint256 w = GaussianMath.gaussianWeight(0, 25 * WAD / 10);
        assertEq(w, WAD);
    }

    function test_gaussianWeight_oneSigma() public pure {
        // distance = sigma -> weight = exp(-0.5) ≈ 0.6065
        uint256 sigma = 25 * WAD / 10; // 2.5
        uint256 w = GaussianMath.gaussianWeight(sigma, sigma);
        uint256 expected = 606_530_659_712_633_424;
        assertApproxEqRel(w, expected, 2e15); // 0.2% tolerance
    }

    function test_gaussianWeight_twoSigma() public pure {
        // distance = 2*sigma -> weight = exp(-2.0) ≈ 0.1353
        uint256 sigma = 25 * WAD / 10;
        uint256 w = GaussianMath.gaussianWeight(2 * sigma, sigma);
        uint256 expected = 135_335_283_236_612_692;
        assertApproxEqRel(w, expected, 5e15); // 0.5% tolerance
    }

    // ═══════════════════════════════ computeBucketWeights TESTS ═══════════════════════════════

    function test_bucketWeights_sumToWAD() public pure {
        uint256[] memory weights = GaussianMath.computeBucketWeights(10, 25 * WAD / 10);
        uint256 sum = 0;
        for (uint256 i = 0; i < 10; i++) {
            sum += weights[i];
        }
        // Should sum to WAD (1e18) within rounding error
        assertApproxEqAbs(sum, WAD, 10); // allow 10 wei rounding
    }

    function test_bucketWeights_symmetric() public pure {
        uint256[] memory weights = GaussianMath.computeBucketWeights(10, 25 * WAD / 10);
        // Bucket i should equal bucket (9-i) due to symmetry
        for (uint256 i = 0; i < 5; i++) {
            assertApproxEqRel(weights[i], weights[9 - i], 1e14); // 0.01%
        }
    }

    function test_bucketWeights_centerHigherThanEdge() public pure {
        uint256[] memory weights = GaussianMath.computeBucketWeights(10, 25 * WAD / 10);
        assertTrue(weights[4] > weights[0], "Center should exceed edge");
        assertTrue(weights[5] > weights[9], "Center should exceed edge");
    }

    function test_bucketWeights_monotonicFromCenter() public pure {
        uint256[] memory weights = GaussianMath.computeBucketWeights(10, 25 * WAD / 10);
        // From center outward, weights should decrease monotonically
        assertTrue(weights[4] >= weights[3], "w4 >= w3");
        assertTrue(weights[3] >= weights[2], "w3 >= w2");
        assertTrue(weights[2] >= weights[1], "w2 >= w1");
        assertTrue(weights[1] >= weights[0], "w1 >= w0");
    }

    function test_bucketWeights_reasonableValues() public pure {
        uint256[] memory weights = GaussianMath.computeBucketWeights(10, 25 * WAD / 10);

        // Center buckets (4,5) should be roughly 15-17% each
        assertTrue(weights[4] > 140e15 && weights[4] < 180e15, "Center weight in range");

        // Edge buckets (0,9) should be roughly 2-5% each
        assertTrue(weights[0] > 20e15 && weights[0] < 60e15, "Edge weight in range");
    }

    function test_bucketWeights_differentSigma() public pure {
        // Smaller sigma → more concentrated
        uint256[] memory narrow = GaussianMath.computeBucketWeights(10, 1 * WAD);
        uint256[] memory wide = GaussianMath.computeBucketWeights(10, 25 * WAD / 10);

        // Narrow sigma should have higher center weight
        assertTrue(narrow[4] > wide[4], "Narrow sigma -> higher center");
        // Narrow sigma should have lower edge weight
        assertTrue(narrow[0] < wide[0], "Narrow sigma -> lower edge");
    }
}

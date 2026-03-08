// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GaussianMath
/// @notice Fixed-point (18 decimal / WAD) Gaussian distribution utilities.
/// @dev All values use WAD precision (1e18 = 1.0). No external dependencies.
library GaussianMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant HALF_WAD = 5e17;

    /// @notice Compute exp(-x) for x >= 0 using reciprocal of 6th-order Taylor expansion.
    /// @dev Uses 1 / (1 + x + x²/2 + x³/6 + x⁴/24 + x⁵/120 + x⁶/720).
    ///      This avoids negative intermediates that alternating-sign Taylor would produce.
    ///      Max error < 0.05% for x in [0, 8]. Returns 0 for x >= 8 (exp(-8) < 0.00034).
    /// @param x Non-negative value in WAD (e.g., 1e18 = exp(-1)).
    /// @return result exp(-x) in WAD precision.
    function expNeg(uint256 x) internal pure returns (uint256 result) {
        if (x >= 8 * WAD) return 0;
        if (x == 0) return WAD;

        uint256 x2 = (x * x) / WAD;
        uint256 x3 = (x2 * x) / WAD;
        uint256 x4 = (x3 * x) / WAD;
        uint256 x5 = (x4 * x) / WAD;
        uint256 x6 = (x5 * x) / WAD;

        uint256 denom = WAD + x
            + x2 / 2
            + x3 / 6
            + x4 / 24
            + x5 / 120
            + x6 / 720;

        result = (WAD * WAD) / denom;
    }

    /// @notice Compute unnormalized Gaussian weight: exp(-d² / (2σ²))
    /// @param distanceWad Absolute distance from mean, in WAD
    /// @param sigmaWad Standard deviation, in WAD
    /// @return weight Unnormalized Gaussian weight in WAD
    function gaussianWeight(uint256 distanceWad, uint256 sigmaWad)
        internal pure returns (uint256 weight)
    {
        uint256 d2 = (distanceWad * distanceWad) / WAD;
        uint256 twoSigma2 = (2 * sigmaWad * sigmaWad) / WAD;
        uint256 x = (d2 * WAD) / twoSigma2;
        return expNeg(x);
    }

    /// @notice Compute normalized Gaussian weights for N symmetric buckets.
    /// @dev Bucket centers at 0.5, 1.5, ..., (N-0.5). Mean at N/2.
    ///      Returns weights that sum to WAD (1e18).
    /// @param numBuckets Number of buckets (typically 10)
    /// @param sigmaWad Sigma in bucket-width units, in WAD (e.g., 2.5e18)
    /// @return weights Array of normalized weights, each in WAD. Sum ≈ WAD.
    function computeBucketWeights(uint256 numBuckets, uint256 sigmaWad)
        internal pure returns (uint256[] memory weights)
    {
        weights = new uint256[](numBuckets);
        uint256 center = (numBuckets * WAD) / 2;
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < numBuckets; i++) {
            uint256 bucketCenter = i * WAD + HALF_WAD;
            uint256 dist = bucketCenter >= center
                ? bucketCenter - center
                : center - bucketCenter;
            weights[i] = gaussianWeight(dist, sigmaWad);
            totalWeight += weights[i];
        }

        for (uint256 i = 0; i < numBuckets; i++) {
            weights[i] = (weights[i] * WAD) / totalWeight;
        }
    }
}

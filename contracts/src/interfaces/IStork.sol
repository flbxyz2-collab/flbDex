// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStork {
    struct TemporalNumericValue {
        uint64 timestampNs;
        int192 quantizedValue;
    }

    /// @notice Get the latest value for a feed, reverts if stale
    function getTemporalNumericValueV1(
        bytes32 id
    ) external view returns (TemporalNumericValue memory value);

    /// @notice Get the latest value without staleness check
    function getTemporalNumericValueUnsafeV1(
        bytes32 id
    ) external view returns (TemporalNumericValue memory value);
}

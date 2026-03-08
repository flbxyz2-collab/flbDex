// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IStork.sol";

/// @title MockOracle
/// @notice Last-resort oracle fallback. Keeper pushes ETH/USDC price from off-chain source.
/// @dev Implements IStork interface so TapGrid can use it interchangeably.
contract MockOracle is IStork {
    address public keeper;
    uint64 public latestTimestampNs;
    int192 public latestPrice;

    constructor(address _keeper) {
        keeper = _keeper;
    }

    function updatePrice(int192 _price) external {
        require(msg.sender == keeper, "Not keeper");
        latestPrice = _price;
        latestTimestampNs = uint64(block.timestamp) * 1e9;
    }

    function getTemporalNumericValueV1(
        bytes32
    ) external view override returns (TemporalNumericValue memory) {
        require(latestTimestampNs > 0, "No price");
        return TemporalNumericValue(latestTimestampNs, latestPrice);
    }

    function getTemporalNumericValueUnsafeV1(
        bytes32
    ) external view override returns (TemporalNumericValue memory) {
        return TemporalNumericValue(latestTimestampNs, latestPrice);
    }
}

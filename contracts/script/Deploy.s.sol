// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TapGrid.sol";
import "../src/MockOracle.sol";

contract DeployTapGrid is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address storkAddress = vm.envAddress("STORK_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        bytes32 storkId = vm.envBytes32("STORK_ETHUSD_ID");
        address keeperAddress = vm.envAddress("KEEPER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        TapGrid tapgrid = new TapGrid(
            storkAddress,
            usdcAddress,
            storkId,
            keeperAddress
        );

        // ETH ~$2500, $2/bucket, 10 buckets = $20 grid range ($2490-$2510)
        // Covers ~4.4σ of 5-min ETH volatility
        tapgrid.createRounds(
            8,
            2_500_000_000_000_000_000_000,  // 2500e18 basePrice
            2_000_000_000_000_000_000        // 2e18 bucketSize ($2)
        );

        vm.stopBroadcast();

        console.log("TapGrid deployed at:", address(tapgrid));
    }
}

contract DeployMock is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        MockOracle mock = new MockOracle(deployer);

        TapGrid tapgrid = new TapGrid(
            address(mock),
            usdcAddress,
            bytes32(uint256(1)),
            deployer
        );

        // ETH ~$2500, $2/bucket, 10 buckets = $20 grid range ($2490-$2510)
        tapgrid.createRounds(
            8,
            2_500_000_000_000_000_000_000,  // 2500e18 basePrice
            2_000_000_000_000_000_000        // 2e18 bucketSize ($2)
        );

        vm.stopBroadcast();

        console.log("MockOracle deployed at:", address(mock));
        console.log("TapGrid deployed at:", address(tapgrid));
    }
}

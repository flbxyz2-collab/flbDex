// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TapGrid.sol";
import "../src/MockOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock USDC for testing — 6 decimals like real USDC
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TapGridTest is Test {
    TapGrid public tapgrid;
    MockOracle public mockStork;
    MockUSDC public usdc;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public keeper = makeAddr("keeper");

    // ETH ~ $2500 in 18 decimals
    uint256 constant BASE_PRICE = 2_500_000_000_000_000_000_000; // 2500e18
    uint256 constant BUCKET_SIZE = 2_000_000_000_000_000_000;     // 2e18 ($2/bucket)

    bytes32 constant STORK_ID = bytes32(uint256(1));

    // USDC amounts (6 decimals)
    uint256 constant USDC_1   = 1_000_000;     // 1 USDC
    uint256 constant USDC_10  = 10_000_000;    // 10 USDC
    uint256 constant USDC_20  = 20_000_000;    // 20 USDC
    uint256 constant USDC_40  = 40_000_000;    // 40 USDC
    uint256 constant USDC_50  = 50_000_000;    // 50 USDC
    uint256 constant USDC_110 = 110_000_000;   // 110 USDC (above MAX_BET)

    function setUp() public {
        mockStork = new MockOracle(keeper);
        usdc = new MockUSDC();

        tapgrid = new TapGrid(
            address(mockStork),
            address(usdc),
            STORK_ID,
            keeper
        );

        // Mint USDC to test accounts (10,000 USDC each)
        usdc.mint(alice, 10_000 * USDC_1);
        usdc.mint(bob, 10_000 * USDC_1);
        usdc.mint(keeper, 10_000 * USDC_1);
        usdc.mint(address(this), 10_000 * USDC_1);

        // Pre-approve TapGrid to spend USDC
        vm.prank(alice);
        usdc.approve(address(tapgrid), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(tapgrid), type(uint256).max);
        vm.prank(keeper);
        usdc.approve(address(tapgrid), type(uint256).max);
        usdc.approve(address(tapgrid), type(uint256).max);
    }

    // ═══════════════════════════════ ROUND CREATION ═══════════════════════════════

    function test_createRounds() public {
        tapgrid.createRounds(8, BASE_PRICE, BUCKET_SIZE);

        assertEq(tapgrid.currentRoundId(), 8);

        // Check first round
        TapGrid.Round memory r1 = tapgrid.getRoundState(1);
        assertEq(r1.roundId, 1);
        assertEq(r1.basePrice, BASE_PRICE);
        assertEq(r1.bucketSize, BUCKET_SIZE);
        assertEq(r1.startTime, uint48(block.timestamp));
        assertEq(r1.endTime, uint48(block.timestamp + 300));
        assertEq(r1.lockTime, uint48(block.timestamp + 270));
        assertFalse(r1.settled);
        assertFalse(r1.cancelled);

        // Check spacing between rounds
        TapGrid.Round memory r2 = tapgrid.getRoundState(2);
        assertEq(r2.startTime, uint48(block.timestamp + 300));
        assertEq(r2.endTime, uint48(block.timestamp + 600));
    }

    function test_createRounds_invalidCount() public {
        vm.expectRevert("Invalid count");
        tapgrid.createRounds(0, BASE_PRICE, BUCKET_SIZE);

        vm.expectRevert("Invalid count");
        tapgrid.createRounds(21, BASE_PRICE, BUCKET_SIZE);
    }

    function test_createRounds_bucketSizeTooSmall_reverts() public {
        // 0.005% of base price is below the 0.01% minimum
        uint256 tinyBucket = BASE_PRICE / 20000;
        vm.expectRevert("Bucket size too small");
        tapgrid.createRounds(1, BASE_PRICE, tinyBucket);
    }

    function test_createRounds_bucketSizeTooLarge_reverts() public {
        // 2% of base price exceeds the 1% maximum
        uint256 hugeBucket = BASE_PRICE / 50;
        vm.expectRevert("Bucket size too large");
        tapgrid.createRounds(1, BASE_PRICE, hugeBucket);
    }

    // ═══════════════════════════════ BETTING ═══════════════════════════════

    function test_placeBet_basic() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        uint256[10] memory bets = tapgrid.getUserBets(1, alice);
        assertEq(bets[4], USDC_10);

        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertEq(r.totalPool, USDC_10);
    }

    function test_placeBet_multipleUsers() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        vm.prank(bob);
        tapgrid.placeBet(1, 6, USDC_20);

        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertEq(r.totalPool, USDC_10 + USDC_20);

        uint256[10] memory aliceBets = tapgrid.getUserBets(1, alice);
        uint256[10] memory bobBets = tapgrid.getUserBets(1, bob);
        assertEq(aliceBets[4], USDC_10);
        assertEq(bobBets[6], USDC_20);
    }

    function test_placeBet_locked_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Warp to lock time (endTime - 30 = startTime + 270)
        vm.warp(block.timestamp + 270);

        vm.prank(alice);
        vm.expectRevert("Round locked");
        tapgrid.placeBet(1, 4, USDC_10);
    }

    function test_placeBet_belowMin_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        vm.expectRevert("Below min bet");
        tapgrid.placeBet(1, 4, 500_000); // 0.5 USDC < 1 USDC min
    }

    function test_placeBet_aboveMax_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        vm.expectRevert("Exceeds max bet");
        tapgrid.placeBet(1, 4, USDC_110); // 110 USDC > 100 USDC max
    }

    function test_placeBet_invalidBucket_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        vm.expectRevert("Invalid bucket");
        tapgrid.placeBet(1, 10, USDC_10);
    }

    function test_placeBet_nonexistentRound_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Round does not exist");
        tapgrid.placeBet(99, 4, USDC_10);
    }

    function test_placeBet_noApproval_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        address charlie = makeAddr("charlie");
        usdc.mint(charlie, 10_000 * USDC_1);
        // Deliberately do NOT approve

        vm.prank(charlie);
        vm.expectRevert();
        tapgrid.placeBet(1, 4, USDC_10);
    }

    // ═══════════════════════════════ SEED LIQUIDITY ═══════════════════════════════

    function test_seedRound_basic() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        uint256 seedAmount = 100 * USDC_1; // 100 USDC total seed

        vm.prank(keeper);
        tapgrid.seedRound(1, seedAmount);

        // Verify round was seeded
        assertTrue(tapgrid.roundSeeded(1));

        // Verify total pool equals seed amount
        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertEq(r.totalPool, seedAmount);

        // Verify all buckets got something
        for (uint8 i = 0; i < 10; i++) {
            assertTrue(tapgrid.bucketDeposits(1, i) > 0, "Bucket should have deposits");
        }

        // Verify center buckets got more than edge buckets (Gaussian distribution)
        uint256 centerDeposit = tapgrid.bucketDeposits(1, 4);
        uint256 edgeDeposit = tapgrid.bucketDeposits(1, 0);
        assertTrue(centerDeposit > edgeDeposit, "Center should have more than edge");

        // Verify symmetry: bucket i ≈ bucket (9-i)
        for (uint8 i = 0; i < 5; i++) {
            uint256 left = tapgrid.bucketDeposits(1, i);
            uint256 right = tapgrid.bucketDeposits(1, 9 - i);
            // Allow 1 USDC tolerance for rounding (last bucket gets remainder)
            assertApproxEqAbs(left, right, USDC_1);
        }
    }

    function test_seedRound_cannotDoubleSeed() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        uint256 seedAmount = 10 * USDC_1;

        vm.startPrank(keeper);
        tapgrid.seedRound(1, seedAmount);

        vm.expectRevert("Already seeded");
        tapgrid.seedRound(1, seedAmount);
        vm.stopPrank();
    }

    function test_seedRound_onlyKeeper() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        vm.expectRevert("Not keeper");
        tapgrid.seedRound(1, 10 * USDC_1);
    }

    function test_seedRound_afterLock_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.warp(block.timestamp + 270); // lock time

        vm.prank(keeper);
        vm.expectRevert("Round locked");
        tapgrid.seedRound(1, 10 * USDC_1);
    }

    function test_seedRound_thenBetAndSettle() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Keeper seeds 50 USDC
        vm.prank(keeper);
        tapgrid.seedRound(1, USDC_50);

        // Alice bets 10 USDC on bucket 4 (center)
        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        // Bob bets 10 USDC on bucket 6
        vm.prank(bob);
        tapgrid.placeBet(1, 6, USDC_10);

        // Settle: price lands in bucket 4
        vm.warp(block.timestamp + 301);
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(1);

        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertTrue(r.settled);
        assertEq(r.winningBucket, 4);

        // Alice claims (she bet on winning bucket 4)
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        tapgrid.claimWinnings(1);
        uint256 aliceAfter = usdc.balanceOf(alice);
        assertTrue(aliceAfter > aliceBefore, "Alice should profit");

        // Keeper also has bets on bucket 4 from seeding, can claim
        uint256 keeperBefore = usdc.balanceOf(keeper);
        vm.prank(keeper);
        tapgrid.claimWinnings(1);
        uint256 keeperAfter = usdc.balanceOf(keeper);
        assertTrue(keeperAfter > keeperBefore, "Keeper should get seed winnings");
    }

    // ═══════════════════════════════ SETTLEMENT ═══════════════════════════════

    function test_settleRound() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Alice bets on bucket 4 (price at center)
        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        // Bob bets on bucket 6
        vm.prank(bob);
        tapgrid.placeBet(1, 6, USDC_10);

        // Warp past end time
        vm.warp(block.timestamp + 301);

        // Set oracle price at center + 0.5 * bucketSize (should land in bucket 4)
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);

        tapgrid.settleRound(1);

        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertTrue(r.settled);
        assertFalse(r.cancelled);
        assertEq(r.winningBucket, 4);
    }

    function test_settleRound_tooEarly_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.expectRevert("Too early");
        tapgrid.settleRound(1);
    }

    // ═══════════════════════════════ CLAIMING ═══════════════════════════════

    function test_claimWinnings_winner() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Alice bets 10 USDC on bucket 4 (winner)
        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        // Bob bets 10 USDC on bucket 6 (loser)
        vm.prank(bob);
        tapgrid.placeBet(1, 6, USDC_10);

        // Settle: price lands in bucket 4
        vm.warp(block.timestamp + 301);
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(1);

        // Alice claims
        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        tapgrid.claimWinnings(1);
        uint256 balanceAfter = usdc.balanceOf(alice);

        // Pool = 20 USDC, fee = 3% = 0.6 USDC, winPool = 19.4 USDC
        // Alice has 100% of winning bucket → gets full 19.4 USDC
        uint256 expectedPayout = (USDC_20 * 9700) / 10000;
        assertEq(balanceAfter - balanceBefore, expectedPayout);
    }

    function test_claimWinnings_loser_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        vm.prank(bob);
        tapgrid.placeBet(1, 6, USDC_10);

        vm.warp(block.timestamp + 301);
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(1);

        // Bob (loser) tries to claim
        vm.prank(bob);
        vm.expectRevert("Not a winner");
        tapgrid.claimWinnings(1);
    }

    function test_claimWinnings_doubleClaim_reverts() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        vm.warp(block.timestamp + 301);
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(1);

        vm.prank(alice);
        tapgrid.claimWinnings(1);

        vm.prank(alice);
        vm.expectRevert("Already claimed");
        tapgrid.claimWinnings(1);
    }

    function test_claimWinnings_cancelled_refund() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Alice bets on bucket 6
        vm.prank(alice);
        tapgrid.placeBet(1, 6, USDC_10);

        // Settle: price lands in bucket 4 (nobody bet there → cancelled)
        vm.warp(block.timestamp + 301);
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(1);

        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertTrue(r.cancelled);

        // Alice gets refund
        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        tapgrid.claimWinnings(1);
        uint256 balanceAfter = usdc.balanceOf(alice);

        assertEq(balanceAfter - balanceBefore, USDC_10);
    }

    function test_batchClaimWinnings() public {
        // Create 2 rounds
        tapgrid.createRounds(2, BASE_PRICE, BUCKET_SIZE);

        // Alice bets on both rounds
        vm.startPrank(alice);
        tapgrid.placeBet(1, 4, USDC_10);
        tapgrid.placeBet(2, 4, USDC_10);
        vm.stopPrank();

        // Bob bets on both rounds (loser buckets)
        vm.startPrank(bob);
        tapgrid.placeBet(1, 6, USDC_10);
        tapgrid.placeBet(2, 6, USDC_10);
        vm.stopPrank();

        // Settle round 1
        vm.warp(block.timestamp + 301);
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(1);

        // Settle round 2
        vm.warp(block.timestamp + 300);
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(2);

        // Batch claim
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        tapgrid.batchClaimWinnings(ids);
        uint256 balanceAfter = usdc.balanceOf(alice);

        uint256 expectedPerRound = (USDC_20 * 9700) / 10000;
        assertEq(balanceAfter - balanceBefore, expectedPerRound * 2);
    }

    // ═══════════════════════════════ VIEW FUNCTIONS ═══════════════════════════════

    function test_getMultipliers() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        vm.prank(bob);
        tapgrid.placeBet(1, 6, USDC_40);

        // Total pool = 50 USDC, net pool (after 3% fee) = 48.5 USDC
        // Bucket 4: 10 USDC → multiplier = 48.5 / 10 * 100 = 485 (4.85x)
        // Bucket 6: 40 USDC → multiplier = 48.5 / 40 * 100 = 121 (1.21x)
        uint256[10] memory m = tapgrid.getMultipliers(1);
        assertEq(m[4], 485);
        assertEq(m[6], 121);
        assertEq(m[0], 0); // no bets
    }

    function test_getExpectedMultipliers() public {
        uint256[10] memory m = tapgrid.getExpectedMultipliers();

        // All multipliers should be > 0
        for (uint8 i = 0; i < 10; i++) {
            assertTrue(m[i] > 0, "Multiplier should be positive");
        }

        // Edge bucket multipliers should be higher than center (less likely to hit)
        assertTrue(m[0] > m[4], "Edge multiplier should exceed center");
        assertTrue(m[9] > m[5], "Edge multiplier should exceed center");

        // Symmetry: bucket i ≈ bucket (9-i)
        assertApproxEqRel(m[0], m[9], 1e16); // 1% tolerance
        assertApproxEqRel(m[1], m[8], 1e16);
        assertApproxEqRel(m[4], m[5], 1e16);

        // Center multiplier should be reasonable (5-7x range)
        assertTrue(m[4] > 400 && m[4] < 800, "Center multiplier in expected range");
    }

    function test_getGridData() public {
        tapgrid.createRounds(3, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        tapgrid.placeBet(2, 4, USDC_10);

        (TapGrid.Round[] memory roundData, uint256[10][] memory deposits) = tapgrid.getGridData(1, 3);

        assertEq(roundData.length, 3);
        assertEq(roundData[0].roundId, 1);
        assertEq(roundData[1].roundId, 2);
        assertEq(roundData[2].roundId, 3);

        assertEq(deposits[1][4], USDC_10); // round 2, bucket 4
        assertEq(deposits[0][4], 0);       // round 1, bucket 4 (no bets)
    }

    // ═══════════════════════════════ PRICE TO BUCKET ═══════════════════════════════

    function test_priceToBucket_extremeUp() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Place bet BEFORE lock
        vm.prank(alice);
        tapgrid.placeBet(1, 0, USDC_1);

        // Price way above grid top → bucket 0
        vm.warp(block.timestamp + 301);
        int192 highPrice = int192(int256(BASE_PRICE + 10 * BUCKET_SIZE));
        vm.prank(keeper);
        mockStork.updatePrice(highPrice);
        tapgrid.settleRound(1);

        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertEq(r.winningBucket, 0);
    }

    function test_priceToBucket_extremeDown() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Place bet BEFORE lock
        vm.prank(alice);
        tapgrid.placeBet(1, 9, USDC_1);

        // Price way below grid bottom → bucket 9
        vm.warp(block.timestamp + 301);
        int192 lowPrice = int192(int256(BASE_PRICE - 10 * BUCKET_SIZE));
        vm.prank(keeper);
        mockStork.updatePrice(lowPrice);
        tapgrid.settleRound(1);

        TapGrid.Round memory r = tapgrid.getRoundState(1);
        assertEq(r.winningBucket, 9);
    }

    // ═══════════════════════════════ ADMIN ═══════════════════════════════

    function test_withdrawFees() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_50);
        vm.prank(bob);
        tapgrid.placeBet(1, 6, USDC_50);

        vm.warp(block.timestamp + 301);
        int192 mockPrice = int192(int256(BASE_PRICE + BUCKET_SIZE / 2));
        vm.prank(keeper);
        mockStork.updatePrice(mockPrice);
        tapgrid.settleRound(1);

        uint256 expectedFee = (2 * USDC_50 * 300) / 10000; // 3 USDC
        assertEq(tapgrid.protocolFees(), expectedFee);

        uint256 ownerBefore = usdc.balanceOf(address(this));
        tapgrid.withdrawFees();
        uint256 ownerAfter = usdc.balanceOf(address(this));

        assertEq(ownerAfter - ownerBefore, expectedFee);
        assertEq(tapgrid.protocolFees(), 0);
    }

    function test_setKeeper() public {
        address newKeeper = makeAddr("newKeeper");
        tapgrid.setKeeper(newKeeper);
        assertEq(tapgrid.keeper(), newKeeper);
    }

    function test_setKeeper_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        tapgrid.setKeeper(alice);
    }

    function test_emergencyWithdraw() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);

        // Seed + user bets put funds in the contract
        vm.prank(keeper);
        tapgrid.seedRound(1, USDC_50);
        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        uint256 contractBalance = usdc.balanceOf(address(tapgrid));
        assertTrue(contractBalance > 0);

        // Owner emergency withdraws everything
        uint256 ownerBefore = usdc.balanceOf(address(this));
        tapgrid.emergencyWithdraw();
        uint256 ownerAfter = usdc.balanceOf(address(this));

        assertEq(ownerAfter - ownerBefore, contractBalance);
        assertEq(usdc.balanceOf(address(tapgrid)), 0);
    }

    function test_emergencyWithdraw_onlyOwner() public {
        tapgrid.createRounds(1, BASE_PRICE, BUCKET_SIZE);
        vm.prank(alice);
        tapgrid.placeBet(1, 4, USDC_10);

        vm.prank(alice);
        vm.expectRevert();
        tapgrid.emergencyWithdraw();
    }
}

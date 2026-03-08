// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IStork.sol";
import "./lib/GaussianMath.sol";
/// @title TapGrid
/// @notice Parimutuel grid-based price prediction game on Base Sepolia.
/// @dev Each "round" = one time column in the 2D grid. Each round has NUM_BUCKETS price rows.
///      Bets are placed in USDC (ERC20). Oracle: Stork ETH/USDC.
contract TapGrid is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════ STRUCTS ═══════════════════════════════

    struct Round {
        uint256 roundId;
        uint256 basePrice;       // center price for grid (18 decimals)
        uint256 bucketSize;      // price range per row (18 decimals)
        uint48 startTime;
        uint48 lockTime;         // endTime - LOCK_BEFORE_END
        uint48 endTime;
        uint256 totalPool;       // sum of all cells in this column
        uint256 settlementPrice; // filled at settlement (18 decimals)
        uint8 winningBucket;     // 0-9
        bool settled;
        bool cancelled;
    }

    // ═══════════════════════════════ CONSTANTS ═══════════════════════════════

    uint256 public constant NUM_BUCKETS = 10;
    uint256 public constant ROUND_INTERVAL = 300;     // 5 minutes
    uint256 public constant LOCK_BEFORE_END = 30;     // 30s lock before end
    uint256 public constant MIN_BET = 1_000_000;      // 1 USDC (6 decimals)
    uint256 public constant MAX_BET = 100_000_000;    // 100 USDC (6 decimals)
    uint256 public constant PROTOCOL_FEE_BPS = 300;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_STALENESS = 300;       // 5 minutes

    // Seed liquidity
    uint256 public constant SEED_SIGMA_WAD = 2_500_000_000_000_000_000; // 2.5 in WAD (bucket-width units)
    uint256 public constant MIN_SEED_PER_BUCKET = 100_000; // 0.1 USDC floor per bucket

    // ═══════════════════════════════ ORACLE STATE ═══════════════════════════════

    IStork public immutable stork;
    IERC20 public immutable betToken;
    bytes32 public immutable ethUsdcStorkId;

    // ═══════════════════════════════ GAME STATE ═══════════════════════════════

    uint256 public currentRoundId;
    uint256 public protocolFees;
    address public keeper;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(uint8 => uint256)) public bucketDeposits;
    mapping(uint256 => mapping(uint8 => mapping(address => uint256))) public userBets;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => bool) public roundSeeded;

    // ═══════════════════════════════ EVENTS ═══════════════════════════════

    event RoundCreated(uint256 indexed roundId, uint48 startTime, uint48 endTime, uint256 basePrice);
    event BetPlaced(uint256 indexed roundId, uint8 indexed bucket, address indexed user, uint256 amount);
    event RoundSettled(uint256 indexed roundId, uint8 winningBucket, uint256 settlementPrice);
    event RoundCancelled(uint256 indexed roundId);
    event WinningsClaimed(uint256 indexed roundId, address indexed user, uint256 amount);
    event RoundSeeded(uint256 indexed roundId, uint256 totalAmount);

    // ═══════════════════════════════ MODIFIERS ═══════════════════════════════

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner(), "Not keeper");
        _;
    }

    // ═══════════════════════════════ CONSTRUCTOR ═══════════════════════════════

    constructor(
        address _stork,
        address _betToken,
        bytes32 _ethUsdcStorkId,
        address _keeper
    ) Ownable(msg.sender) {
        stork = IStork(_stork);
        betToken = IERC20(_betToken);
        ethUsdcStorkId = _ethUsdcStorkId;
        keeper = _keeper;
    }

    // ═══════════════════════════════ BET LOGIC ═══════════════════════════════

    /// @notice Place a bet on a specific cell: round = time column, bucketIndex = price row
    function placeBet(uint256 roundId, uint8 bucketIndex, uint256 amount) external {
        require(bucketIndex < NUM_BUCKETS, "Invalid bucket");
        require(amount >= MIN_BET, "Below min bet");

        Round storage round = rounds[roundId];
        require(round.endTime > 0, "Round does not exist");
        require(block.timestamp < round.lockTime, "Round locked");
        require(!round.settled && !round.cancelled, "Round finished");
        require(
            userBets[roundId][bucketIndex][msg.sender] + amount <= MAX_BET,
            "Exceeds max bet"
        );

        betToken.safeTransferFrom(msg.sender, address(this), amount);

        userBets[roundId][bucketIndex][msg.sender] += amount;
        bucketDeposits[roundId][bucketIndex] += amount;
        round.totalPool += amount;

        emit BetPlaced(roundId, bucketIndex, msg.sender, amount);
    }

    // ═══════════════════════════════ SEED LIQUIDITY ═══════════════════════════════

    /// @notice Seed a round with Gaussian-weighted liquidity across all buckets.
    /// @dev Single tx replaces 10 separate placeBet calls. Bypasses MIN/MAX_BET intentionally.
    /// @param roundId The round to seed
    /// @param totalSeedAmount Total USDC to distribute (6 decimals)
    function seedRound(uint256 roundId, uint256 totalSeedAmount) external onlyKeeper {
        Round storage round = rounds[roundId];
        require(round.endTime > 0, "Round does not exist");
        require(block.timestamp < round.lockTime, "Round locked");
        require(!round.settled && !round.cancelled, "Round finished");
        require(!roundSeeded[roundId], "Already seeded");
        require(totalSeedAmount >= MIN_SEED_PER_BUCKET * NUM_BUCKETS, "Seed too small");

        betToken.safeTransferFrom(msg.sender, address(this), totalSeedAmount);

        uint256[] memory weights = GaussianMath.computeBucketWeights(NUM_BUCKETS, SEED_SIGMA_WAD);

        uint256 distributed = 0;
        for (uint8 i = 0; i < NUM_BUCKETS; i++) {
            uint256 amount;
            if (i == NUM_BUCKETS - 1) {
                amount = totalSeedAmount - distributed;
            } else {
                amount = (totalSeedAmount * weights[i]) / 1e18;
                if (amount < MIN_SEED_PER_BUCKET) {
                    amount = MIN_SEED_PER_BUCKET;
                }
            }

            userBets[roundId][i][msg.sender] += amount;
            bucketDeposits[roundId][i] += amount;
            distributed += amount;

            emit BetPlaced(roundId, i, msg.sender, amount);
        }

        round.totalPool += distributed;
        roundSeeded[roundId] = true;

        emit RoundSeeded(roundId, distributed);
    }

    // ═══════════════════════════════ SETTLEMENT ═══════════════════════════════

    /// @notice Settle a round using Stork oracle (pushed feed — no calldata needed)
    function settleRound(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        require(block.timestamp >= round.endTime, "Too early");
        require(!round.settled && !round.cancelled, "Already finished");

        IStork.TemporalNumericValue memory price = stork.getTemporalNumericValueUnsafeV1(ethUsdcStorkId);

        uint64 priceTimestamp = price.timestampNs / 1e9;
        require(priceTimestamp + MAX_STALENESS >= round.endTime, "Price too stale");

        uint256 settlementPrice = uint256(int256(price.quantizedValue));
        _resolveRound(roundId, settlementPrice);
    }

    /// @dev Resolve the round: determine winner, apply fee, or cancel if no winner
    function _resolveRound(uint256 roundId, uint256 settlementPrice) internal {
        Round storage round = rounds[roundId];

        uint8 winningBucket = _priceToBucket(settlementPrice, round.basePrice, round.bucketSize);

        round.settlementPrice = settlementPrice;
        round.winningBucket = winningBucket;

        if (bucketDeposits[roundId][winningBucket] == 0) {
            round.cancelled = true;
            emit RoundCancelled(roundId);
            return;
        }

        uint256 fee = (round.totalPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        protocolFees += fee;

        round.settled = true;
        emit RoundSettled(roundId, winningBucket, settlementPrice);
    }

    /// @dev Map a settlement price to a bucket index (0 = highest price, 9 = lowest)
    /// Grid layout: bucket 0 is the top row (highest price), bucket 9 is bottom (lowest)
    /// Center of grid is between buckets 4 and 5 at basePrice.
    function _priceToBucket(
        uint256 price,
        uint256 basePrice,
        uint256 bucketSize
    ) internal pure returns (uint8) {
        // Top of grid = basePrice + 5 * bucketSize
        uint256 gridTop = basePrice + 5 * bucketSize;

        if (price >= gridTop) {
            return 0; // extreme up
        }

        // Bottom of grid = basePrice - 5 * bucketSize
        if (basePrice < 5 * bucketSize) {
            // Prevent underflow if price is near zero
            if (price < basePrice) return 9;
        } else {
            uint256 gridBottom = basePrice - 5 * bucketSize;
            if (price < gridBottom) {
                return 9; // extreme down
            }
        }

        // Normal case: price is within grid range
        // Bucket i covers [gridTop - (i+1)*bucketSize, gridTop - i*bucketSize)
        // So bucket = (gridTop - price) / bucketSize, clamped to [0, 9]
        uint256 offset = gridTop - price;
        uint256 bucket = offset / bucketSize;

        if (bucket >= NUM_BUCKETS) return 9;
        return uint8(bucket);
    }

    // ═══════════════════════════════ CLAIMING ═══════════════════════════════

    /// @notice Claim winnings (or refund if cancelled) from a settled round
    function claimWinnings(uint256 roundId) external nonReentrant {
        _claim(roundId, msg.sender);
    }

    /// @notice Batch claim from multiple rounds
    function batchClaimWinnings(uint256[] calldata roundIds) external nonReentrant {
        for (uint256 i = 0; i < roundIds.length; i++) {
            _claim(roundIds[i], msg.sender);
        }
    }

    function _claim(uint256 roundId, address user) internal {
        Round storage round = rounds[roundId];
        require(round.settled || round.cancelled, "Not finished");
        require(!claimed[roundId][user], "Already claimed");

        claimed[roundId][user] = true;
        uint256 payout;

        if (round.cancelled) {
            // Refund all bets across all buckets
            for (uint8 i = 0; i < NUM_BUCKETS; i++) {
                payout += userBets[roundId][i][user];
            }
            require(payout > 0, "Nothing to refund");
        } else {
            // Pay out winners
            uint8 wb = round.winningBucket;
            uint256 userStake = userBets[roundId][wb][user];
            require(userStake > 0, "Not a winner");

            uint256 fee = (round.totalPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
            uint256 winPool = round.totalPool - fee;

            payout = (winPool * userStake) / bucketDeposits[roundId][wb];
        }

        betToken.safeTransfer(user, payout);
        emit WinningsClaimed(roundId, user, payout);
    }

    // ═══════════════════════════════ ROUND MANAGEMENT ═══════════════════════════════

    /// @notice Create next N rounds (time columns) with staggered endTimes
    function createRounds(
        uint256 count,
        uint256 basePrice,
        uint256 bucketSize
    ) external {
        require(count > 0 && count <= 20, "Invalid count");
        require(bucketSize > 0, "Zero bucket size");
        require(bucketSize >= basePrice / 10000, "Bucket size too small");
        require(bucketSize <= basePrice / 100, "Bucket size too large");

        for (uint256 i = 0; i < count; i++) {
            uint256 roundId = ++currentRoundId;
            uint48 startTime = uint48(block.timestamp + i * ROUND_INTERVAL);
            uint48 endTime = startTime + uint48(ROUND_INTERVAL);
            uint48 lockTime = endTime - uint48(LOCK_BEFORE_END);

            rounds[roundId] = Round({
                roundId: roundId,
                basePrice: basePrice,
                bucketSize: bucketSize,
                startTime: startTime,
                lockTime: lockTime,
                endTime: endTime,
                totalPool: 0,
                settlementPrice: 0,
                winningBucket: 0,
                settled: false,
                cancelled: false
            });

            emit RoundCreated(roundId, startTime, endTime, basePrice);
        }
    }

    // ═══════════════════════════════ VIEW FUNCTIONS ═══════════════════════════════

    /// @notice Get multipliers for all 10 cells in one column (returns x100, e.g. 250 = 2.5x)
    function getMultipliers(uint256 roundId) external view returns (uint256[10] memory multipliers) {
        uint256 total = rounds[roundId].totalPool;
        if (total == 0) return multipliers;

        uint256 netTotal = (total * (BPS_DENOMINATOR - PROTOCOL_FEE_BPS)) / BPS_DENOMINATOR;

        for (uint8 i = 0; i < 10; i++) {
            uint256 deposit = bucketDeposits[roundId][i];
            if (deposit > 0) {
                multipliers[i] = (netTotal * 100) / deposit;
            }
        }
    }

    /// @notice Batch load grid data for N columns
    function getGridData(
        uint256 fromRoundId,
        uint256 count
    ) external view returns (Round[] memory roundData, uint256[10][] memory deposits) {
        roundData = new Round[](count);
        deposits = new uint256[10][](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 rid = fromRoundId + i;
            roundData[i] = rounds[rid];
            for (uint8 j = 0; j < 10; j++) {
                deposits[i][j] = bucketDeposits[rid][j];
            }
        }
    }

    /// @notice Get a user's bets in one column
    function getUserBets(
        uint256 roundId,
        address user
    ) external view returns (uint256[10] memory bets) {
        for (uint8 i = 0; i < 10; i++) {
            bets[i] = userBets[roundId][i][user];
        }
    }

    /// @notice Get full round state
    function getRoundState(uint256 roundId) external view returns (Round memory) {
        return rounds[roundId];
    }

    /// @notice Compute expected fair multipliers based on Gaussian probability (x100).
    /// @dev Pure computation — shows theoretical odds independent of actual bets.
    function getExpectedMultipliers() external pure returns (uint256[10] memory multipliers) {
        uint256[] memory weights = GaussianMath.computeBucketWeights(NUM_BUCKETS, SEED_SIGMA_WAD);
        uint256 netFraction = BPS_DENOMINATOR - PROTOCOL_FEE_BPS; // 9700

        for (uint8 i = 0; i < 10; i++) {
            if (weights[i] > 0) {
                multipliers[i] = (1e18 * netFraction * 100) / (weights[i] * BPS_DENOMINATOR);
            }
        }
    }

    // ═══════════════════════════════ ADMIN ═══════════════════════════════

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = protocolFees;
        protocolFees = 0;
        betToken.safeTransfer(owner(), amount);
    }

    /// @notice Emergency withdraw entire USDC balance. Use only if funds are stuck.
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = betToken.balanceOf(address(this));
        require(balance > 0, "Nothing to withdraw");
        betToken.safeTransfer(owner(), balance);
    }
}

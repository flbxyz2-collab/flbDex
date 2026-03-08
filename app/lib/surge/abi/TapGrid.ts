export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const TAPGRID_ABI = [
  {
    "type": "constructor",
    "inputs": [
      { "name": "_stork", "type": "address", "internalType": "address" },
      { "name": "_betToken", "type": "address", "internalType": "address" },
      { "name": "_ethUsdcStorkId", "type": "bytes32", "internalType": "bytes32" },
      { "name": "_keeper", "type": "address", "internalType": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DENOMINATOR",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "LOCK_BEFORE_END",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_BET",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_STALENESS",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_BET",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "NUM_BUCKETS",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PROTOCOL_FEE_BPS",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ROUND_INTERVAL",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "batchClaimWinnings",
    "inputs": [{ "name": "roundIds", "type": "uint256[]", "internalType": "uint256[]" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "betToken",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "contract IERC20" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bucketDeposits",
    "inputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" },
      { "name": "", "type": "uint8", "internalType": "uint8" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimWinnings",
    "inputs": [{ "name": "roundId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimed",
    "inputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" },
      { "name": "", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createRounds",
    "inputs": [
      { "name": "count", "type": "uint256", "internalType": "uint256" },
      { "name": "basePrice", "type": "uint256", "internalType": "uint256" },
      { "name": "bucketSize", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "currentRoundId",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ethUsdcStorkId",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getExpectedMultipliers",
    "inputs": [],
    "outputs": [{ "name": "multipliers", "type": "uint256[10]", "internalType": "uint256[10]" }],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "getGridData",
    "inputs": [
      { "name": "fromRoundId", "type": "uint256", "internalType": "uint256" },
      { "name": "count", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [
      {
        "name": "roundData",
        "type": "tuple[]",
        "internalType": "struct TapGrid.Round[]",
        "components": [
          { "name": "roundId", "type": "uint256", "internalType": "uint256" },
          { "name": "basePrice", "type": "uint256", "internalType": "uint256" },
          { "name": "bucketSize", "type": "uint256", "internalType": "uint256" },
          { "name": "startTime", "type": "uint48", "internalType": "uint48" },
          { "name": "lockTime", "type": "uint48", "internalType": "uint48" },
          { "name": "endTime", "type": "uint48", "internalType": "uint48" },
          { "name": "totalPool", "type": "uint256", "internalType": "uint256" },
          { "name": "settlementPrice", "type": "uint256", "internalType": "uint256" },
          { "name": "winningBucket", "type": "uint8", "internalType": "uint8" },
          { "name": "settled", "type": "bool", "internalType": "bool" },
          { "name": "cancelled", "type": "bool", "internalType": "bool" }
        ]
      },
      { "name": "deposits", "type": "uint256[10][]", "internalType": "uint256[10][]" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMultipliers",
    "inputs": [{ "name": "roundId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "multipliers", "type": "uint256[10]", "internalType": "uint256[10]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRoundState",
    "inputs": [{ "name": "roundId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TapGrid.Round",
        "components": [
          { "name": "roundId", "type": "uint256", "internalType": "uint256" },
          { "name": "basePrice", "type": "uint256", "internalType": "uint256" },
          { "name": "bucketSize", "type": "uint256", "internalType": "uint256" },
          { "name": "startTime", "type": "uint48", "internalType": "uint48" },
          { "name": "lockTime", "type": "uint48", "internalType": "uint48" },
          { "name": "endTime", "type": "uint48", "internalType": "uint48" },
          { "name": "totalPool", "type": "uint256", "internalType": "uint256" },
          { "name": "settlementPrice", "type": "uint256", "internalType": "uint256" },
          { "name": "winningBucket", "type": "uint8", "internalType": "uint8" },
          { "name": "settled", "type": "bool", "internalType": "bool" },
          { "name": "cancelled", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getUserBets",
    "inputs": [
      { "name": "roundId", "type": "uint256", "internalType": "uint256" },
      { "name": "user", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "bets", "type": "uint256[10]", "internalType": "uint256[10]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "keeper",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "placeBet",
    "inputs": [
      { "name": "roundId", "type": "uint256", "internalType": "uint256" },
      { "name": "bucketIndex", "type": "uint8", "internalType": "uint8" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "roundSeeded",
    "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "seedRound",
    "inputs": [
      { "name": "roundId", "type": "uint256", "internalType": "uint256" },
      { "name": "totalSeedAmount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settleRound",
    "inputs": [{ "name": "roundId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "BetPlaced",
    "inputs": [
      { "name": "roundId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "bucket", "type": "uint8", "indexed": true, "internalType": "uint8" },
      { "name": "user", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundCreated",
    "inputs": [
      { "name": "roundId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "startTime", "type": "uint48", "indexed": false, "internalType": "uint48" },
      { "name": "endTime", "type": "uint48", "indexed": false, "internalType": "uint48" },
      { "name": "basePrice", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundSeeded",
    "inputs": [
      { "name": "roundId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "totalAmount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundSettled",
    "inputs": [
      { "name": "roundId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "winningBucket", "type": "uint8", "indexed": false, "internalType": "uint8" },
      { "name": "settlementPrice", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundCancelled",
    "inputs": [
      { "name": "roundId", "type": "uint256", "indexed": true, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WinningsClaimed",
    "inputs": [
      { "name": "roundId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "user", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  }
] as const

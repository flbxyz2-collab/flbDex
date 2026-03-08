// ─── Round status (mirrors server/types.ts) ───
export type RoundStatus = 'open' | 'locked' | 'settling' | 'settled' | 'cancelled'

// ─── Serialized round from WS (bigint → string) ───
export interface SerializedRound {
  roundId: number
  basePrice: string
  bucketSize: string
  startTime: number
  lockTime: number
  endTime: number
  totalPool: string
  bucketDeposits: string[]
  settlementPrice: string
  winningBucket: number
  status: RoundStatus
  settled: boolean
  cancelled: boolean
}

// ─── Server → Client messages ───
export type ServerMessage =
  | { type: 'price'; price: number; timestamp: number }
  | { type: 'grid_state'; rounds: SerializedRound[] }
  | { type: 'cell_update'; roundId: number; bucket: number; totalDeposit: string; columnTotal: string }
  | { type: 'round_created'; roundId: number; endTime: number; basePrice: string }
  | { type: 'round_locked'; roundId: number }
  | { type: 'round_settled'; roundId: number; winningBucket: number; settlementPrice: string }
  | { type: 'round_cancelled'; roundId: number }

// ─── Per-cell UI data ───
export interface GridCell {
  roundId: number
  bucketIndex: number
  deposit: bigint
  columnTotal: bigint
  multiplier: number
  userBet: bigint
  priceRange: { low: number; high: number }
}

// ─── Per-column (time slot) UI data ───
export interface GridColumn {
  roundId: number
  status: RoundStatus
  endTime: number
  lockTime: number
  basePrice: number
  bucketSize: number
  cells: GridCell[]
  totalPool: bigint
  winningBucket: number
  settlementPrice: number
}

// ─── Selected cell for BetSheet ───
export interface SelectedCell {
  roundId: number
  bucketIndex: number
  priceRange: { low: number; high: number }
  currentMultiplier: number
  columnStatus: RoundStatus
  endTime: number
}

// ─── Price data point for chart ───
export interface PricePoint {
  time: number
  value: number
}

// ─── Round status derived from timestamps ───
export type RoundStatus = 'open' | 'locked' | 'settling' | 'settled' | 'cancelled'

// ─── In-memory representation of a single round (column) ───
export interface CachedRound {
  roundId: number
  basePrice: bigint
  bucketSize: bigint
  startTime: number
  lockTime: number
  endTime: number
  totalPool: bigint
  bucketDeposits: bigint[] // length 10
  settlementPrice: bigint
  winningBucket: number
  settled: boolean
  cancelled: boolean
}

// ─── Serialized round for JSON transport (bigint → string) ───
export interface SerializedRound {
  roundId: number
  basePrice: string
  bucketSize: string
  startTime: number
  lockTime: number
  endTime: number
  totalPool: string
  bucketDeposits: string[] // 10 elements
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

// ─── Helpers ───

export function deriveStatus(round: CachedRound, now: number): RoundStatus {
  if (round.settled) return 'settled'
  if (round.cancelled) return 'cancelled'
  if (now >= round.endTime) return 'settling'
  if (now >= round.lockTime) return 'locked'
  return 'open'
}

export function serializeRound(round: CachedRound): SerializedRound {
  const now = Math.floor(Date.now() / 1000)
  return {
    roundId: round.roundId,
    basePrice: round.basePrice.toString(),
    bucketSize: round.bucketSize.toString(),
    startTime: round.startTime,
    lockTime: round.lockTime,
    endTime: round.endTime,
    totalPool: round.totalPool.toString(),
    bucketDeposits: round.bucketDeposits.map((d) => d.toString()),
    settlementPrice: round.settlementPrice.toString(),
    winningBucket: round.winningBucket,
    status: deriveStatus(round, now),
    settled: round.settled,
    cancelled: round.cancelled,
  }
}

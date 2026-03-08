import type { PublicClient } from 'viem'
import { TAPGRID_ABI } from './abi'
import { type CachedRound, type SerializedRound, serializeRound } from './types'

// ─── In-memory state ───
const rounds = new Map<number, CachedRound>()

const TAPGRID_ADDRESS = process.env.NEXT_PUBLIC_TAPGRID_ADDRESS as `0x${string}`

// ─── Load from chain on startup ───
export async function loadFromChain(publicClient: PublicClient): Promise<void> {
  const currentId = await publicClient.readContract({
    address: TAPGRID_ADDRESS,
    abi: TAPGRID_ABI,
    functionName: 'currentRoundId',
  }) as bigint

  const currentRoundId = Number(currentId)
  if (currentRoundId === 0) {
    console.log('No rounds created yet on chain')
    return
  }

  // Load all rounds (or last 30 if many exist)
  const fromId = Math.max(1, currentRoundId - 29)
  const count = currentRoundId - fromId + 1

  const result = await publicClient.readContract({
    address: TAPGRID_ADDRESS,
    abi: TAPGRID_ABI,
    functionName: 'getGridData',
    args: [BigInt(fromId), BigInt(count)],
  }) as unknown as [any[], bigint[][]]
  const [roundData, deposits] = result

  for (let i = 0; i < roundData.length; i++) {
    const r = roundData[i]
    const rid = Number(r.roundId)
    if (rid === 0) continue // skip empty/non-existent rounds

    const bucketDeps: bigint[] = []
    for (let j = 0; j < 10; j++) {
      bucketDeps.push(deposits[i][j])
    }

    rounds.set(rid, {
      roundId: rid,
      basePrice: r.basePrice,
      bucketSize: r.bucketSize,
      startTime: Number(r.startTime),
      lockTime: Number(r.lockTime),
      endTime: Number(r.endTime),
      totalPool: r.totalPool,
      bucketDeposits: bucketDeps,
      settlementPrice: r.settlementPrice,
      winningBucket: Number(r.winningBucket),
      settled: r.settled,
      cancelled: r.cancelled,
    })
  }
}

// ─── Reads ───

export function getRound(roundId: number): CachedRound | undefined {
  return rounds.get(roundId)
}

export function getAllActiveRounds(): CachedRound[] {
  const now = Math.floor(Date.now() / 1000)
  const active: CachedRound[] = []

  for (const round of rounds.values()) {
    // Include if: not finished, or finished recently (within 120s)
    if (!round.settled && !round.cancelled) {
      active.push(round)
    } else if (round.endTime > now - 120) {
      active.push(round)
    }
  }

  return active.sort((a, b) => a.roundId - b.roundId)
}

export function getFullGridState(): SerializedRound[] {
  return getAllActiveRounds().map(serializeRound)
}

// ─── Updates ───

export function updateFromBetPlaced(roundId: number, bucket: number, amount: bigint): void {
  const round = rounds.get(roundId)
  if (!round) return
  round.bucketDeposits[bucket] += amount
  round.totalPool += amount
}

export function updateFromRoundSettled(roundId: number, winningBucket: number, settlementPrice: bigint): void {
  const round = rounds.get(roundId)
  if (!round) return
  round.settled = true
  round.winningBucket = winningBucket
  round.settlementPrice = settlementPrice
}

export function updateFromRoundCancelled(roundId: number): void {
  const round = rounds.get(roundId)
  if (!round) return
  round.cancelled = true
}

export function addRound(round: CachedRound): void {
  rounds.set(round.roundId, round)
}

// ─── Queries for keeper ───

export function getUnsettledExpiredRounds(now: number): CachedRound[] {
  const result: CachedRound[] = []
  for (const round of rounds.values()) {
    if (round.endTime <= now && !round.settled && !round.cancelled) {
      result.push(round)
    }
  }
  return result.sort((a, b) => a.roundId - b.roundId)
}

export function getLatestRoundEndTime(): number {
  let latest = 0
  for (const round of rounds.values()) {
    if (round.endTime > latest) {
      latest = round.endTime
    }
  }
  return latest
}

// ─── Maintenance ───

export function pruneOldRounds(): void {
  const now = Math.floor(Date.now() / 1000)
  for (const [id, round] of rounds) {
    if ((round.settled || round.cancelled) && round.endTime < now - 120) {
      rounds.delete(id)
    }
  }
}

export function getRoundCount(): number {
  return rounds.size
}

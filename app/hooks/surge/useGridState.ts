
import { useMemo, useState } from 'react'
import { useReadContracts } from 'wagmi'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useWebSocket } from './useWebSocket'
import { TAPGRID_ABI, TAPGRID_ADDRESS } from '../../lib/surge/contracts'
import { NUM_BUCKETS, GRID_VISIBLE_COLUMNS, PRICE_DECIMALS } from '../../lib/surge/constants'
import type { GridColumn, GridCell } from '../../lib/surge/types'

const WEI = BigInt(10) ** BigInt(PRICE_DECIMALS)

function bigintToFloat(val: bigint): number {
  return Number(val) / Number(WEI)
}

function parseBigIntString(s: string): bigint {
  try {
    return BigInt(s)
  } catch {
    return 0n
  }
}

// Euphoria-style multiplier estimation — exponential growth from current price.
// Center (at price) ~2X, edges ~30X. Further columns have flatter distribution
// (simulating more accumulated bets over time, like Euphoria).
function estimateMultiplier(bucketIndex: number, priceRow: number, colIndex: number): number {
  const center = priceRow >= 0 ? priceRow : (NUM_BUCKETS - 1) / 2
  const distance = Math.abs(bucketIndex - center)
  // Decay rate: further columns → lower k → flatter → lower edge mults
  const k = 0.82 - colIndex * 0.015
  return 1.5 + 0.5 * Math.exp(k * distance)
}

interface UseGridStateReturn {
  columns: GridColumn[]
  loading: boolean
  currentPriceRow: number
  selectedBetAmount: number
  setSelectedBetAmount: (amount: number) => void
}

export function useGridState(): UseGridStateReturn {
  const { price, roundsVersion, getRounds } = useWebSocket()
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()

  const [selectedBetAmount, setSelectedBetAmount] = useState(1)

  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0]
  const userAddress = wallet?.address as `0x${string}` | undefined

  // Transform rounds from WS into sorted GridColumn[]
  const { columns, roundIds } = useMemo(() => {
    const rounds = getRounds()
    if (rounds.size === 0) return { columns: [] as GridColumn[], roundIds: [] as number[] }

    const now = Math.floor(Date.now() / 1000)

    // Sort rounds by endTime, filter visible
    const sorted = Array.from(rounds.values())
      .sort((a, b) => a.endTime - b.endTime)
      .filter((r) => {
        // Keep settled rounds for 30s after endTime
        if (r.status === 'settled' || r.status === 'cancelled') {
          return r.endTime > now - 30
        }
        return true
      })

    // Limit: 2 settled/settling + GRID_VISIBLE_COLUMNS open/locked
    const settled = sorted.filter(
      (r) => r.status === 'settled' || r.status === 'settling' || r.status === 'cancelled'
    )
    const active = sorted.filter(
      (r) => r.status === 'open' || r.status === 'locked'
    )

    const visible = [
      ...settled.slice(-2),
      ...active.slice(0, GRID_VISIBLE_COLUMNS),
    ]

    // Compute which bucket the current price falls in (for estimation centering)
    let priceRow = -1
    if (price > 0 && visible.length > 0) {
      const ref = visible.find((r) => r.status === 'open' || r.status === 'locked') ?? visible[0]
      const refBase = bigintToFloat(parseBigIntString(ref.basePrice))
      const refBucket = bigintToFloat(parseBigIntString(ref.bucketSize))
      if (refBucket > 0) {
        const refTop = refBase + 5 * refBucket
        const offset = refTop - price
        priceRow = Math.max(0, Math.min(NUM_BUCKETS - 1, Math.floor(offset / refBucket)))
      }
    }

    const ids: number[] = []
    const cols: GridColumn[] = visible.map((round, colIdx) => {
      const basePrice = bigintToFloat(parseBigIntString(round.basePrice))
      const bucketSize = bigintToFloat(parseBigIntString(round.bucketSize))
      const totalPool = parseBigIntString(round.totalPool)
      const gridTop = basePrice + 5 * bucketSize

      ids.push(round.roundId)

      const cells: GridCell[] = Array.from({ length: NUM_BUCKETS }, (_, i) => {
        const deposit = parseBigIntString(round.bucketDeposits[i] ?? '0')

        // Always use estimated multipliers for consistent display
        const multiplier = estimateMultiplier(i, priceRow, colIdx)

        // Bucket i covers [gridTop - (i+1)*bucketSize, gridTop - i*bucketSize)
        const high = gridTop - i * bucketSize
        const low = gridTop - (i + 1) * bucketSize

        return {
          roundId: round.roundId,
          bucketIndex: i,
          deposit,
          columnTotal: totalPool,
          multiplier,
          userBet: 0n, // filled from contract read below
          priceRange: { low, high },
        }
      })

      return {
        roundId: round.roundId,
        status: round.status,
        endTime: round.endTime,
        lockTime: round.lockTime,
        basePrice,
        bucketSize,
        cells,
        totalPool,
        winningBucket: round.winningBucket,
        settlementPrice: bigintToFloat(parseBigIntString(round.settlementPrice)),
      }
    })

    return { columns: cols, roundIds: ids }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundsVersion, price])

  // Batch fetch user bets for all visible rounds
  const contracts = useMemo(() => {
    if (!authenticated || !userAddress || roundIds.length === 0) return []
    return roundIds.map((roundId) => ({
      address: TAPGRID_ADDRESS,
      abi: TAPGRID_ABI,
      functionName: 'getUserBets' as const,
      args: [BigInt(roundId), userAddress] as const,
    }))
  }, [authenticated, userAddress, roundIds])

  const { data: userBetsData } = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
      staleTime: 10_000,
      refetchInterval: 10_000,
    },
  })

  // Merge user bets into columns
  const columnsWithBets = useMemo(() => {
    if (!userBetsData || userBetsData.length === 0) return columns

    return columns.map((col, colIdx) => {
      const result = userBetsData[colIdx]
      if (!result || result.status !== 'success' || !result.result) return col

      const bets = result.result as readonly bigint[]
      const cellsWithBets = col.cells.map((cell, i) => ({
        ...cell,
        userBet: bets[i] ?? 0n,
      }))

      return { ...col, cells: cellsWithBets }
    })
  }, [columns, userBetsData])

  // Determine which row the current price falls in
  const currentPriceRow = useMemo(() => {
    if (price === 0 || columnsWithBets.length === 0) return -1
    // Use first non-settled column for bucket mapping
    const refCol =
      columnsWithBets.find((c) => c.status === 'open' || c.status === 'locked') ??
      columnsWithBets[0]
    if (!refCol || refCol.bucketSize === 0) return -1

    const gridTop = refCol.basePrice + 5 * refCol.bucketSize
    if (price >= gridTop) return 0

    const gridBottom = refCol.basePrice - 5 * refCol.bucketSize
    if (price < gridBottom) return NUM_BUCKETS - 1

    const offset = gridTop - price
    const bucket = Math.floor(offset / refCol.bucketSize)
    return Math.min(bucket, NUM_BUCKETS - 1)
  }, [price, columnsWithBets])

  return {
    columns: columnsWithBets,
    loading: columnsWithBets.length === 0 && price === 0,
    currentPriceRow,
    selectedBetAmount,
    setSelectedBetAmount,
  }
}

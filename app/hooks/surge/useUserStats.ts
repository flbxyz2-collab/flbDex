
import { useMemo } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useReadContract, useReadContracts } from 'wagmi'
import { TAPGRID_ABI, TAPGRID_ADDRESS } from '../../lib/surge/contracts'

export interface BetRecord {
  roundId: number
  bucket: number
  amount: bigint
}

export interface UserStats {
  totalBets: number
  totalBetAmount: bigint
  totalWon: bigint
  netProfit: bigint
  winCount: number
  winRate: number
  recentBets: BetRecord[]
  betRoundIds: number[]
  claimedRoundIds: Set<number>
}

const LOOKBACK = 50
const CONTRACT = { address: TAPGRID_ADDRESS, abi: TAPGRID_ABI } as const

export function useUserStats() {
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()
  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0]
  const userAddress = wallet?.address as `0x${string}` | undefined

  const enabled = authenticated && !!userAddress

  // Step 1: Get current round ID (single eth_call)
  const { data: currentRoundId, isLoading: roundIdLoading } = useReadContract({
    ...CONTRACT,
    functionName: 'currentRoundId',
    query: { enabled, staleTime: 30_000 },
  })

  // Step 2: Build batch — getUserBets + getRoundState + claimed for last N rounds
  const { phase1Contracts, roundIds } = useMemo(() => {
    if (currentRoundId == null || !userAddress) return { phase1Contracts: [], roundIds: [] }
    const id = Number(currentRoundId)
    if (id === 0) return { phase1Contracts: [], roundIds: [] }

    const from = Math.max(1, id - LOOKBACK + 1)
    const ids = Array.from({ length: id - from + 1 }, (_, i) => from + i)

    const calls = ids.flatMap((r) => [
      {
        ...CONTRACT,
        functionName: 'getUserBets' as const,
        args: [BigInt(r), userAddress] as const,
      },
      {
        ...CONTRACT,
        functionName: 'getRoundState' as const,
        args: [BigInt(r)] as const,
      },
      {
        ...CONTRACT,
        functionName: 'claimed' as const,
        args: [BigInt(r), userAddress] as const,
      },
    ])

    return { phase1Contracts: calls, roundIds: ids }
  }, [currentRoundId, userAddress])

  // Single multicall RPC call for all rounds
  const { data: phase1Data, isLoading: phase1Loading } = useReadContracts({
    contracts: phase1Contracts,
    query: { enabled: phase1Contracts.length > 0, staleTime: 30_000 },
  })

  // Step 3: Process phase 1 results, identify won rounds for payout calculation
  const { intermediateStats, wonRounds } = useMemo(() => {
    if (!phase1Data || roundIds.length === 0) {
      return { intermediateStats: null, wonRounds: [] }
    }

    let totalBets = 0
    let totalBetAmount = 0n
    let winCount = 0
    const recentBets: BetRecord[] = []
    const betRoundIds: number[] = []
    const claimedRoundIds = new Set<number>()
    const won: Array<{ roundId: number; userBetOnWinner: bigint; totalPool: bigint; winningBucket: number }> = []

    for (let i = 0; i < roundIds.length; i++) {
      const betsResult = phase1Data[i * 3]
      const roundResult = phase1Data[i * 3 + 1]
      const claimedResult = phase1Data[i * 3 + 2]
      const roundId = roundIds[i]

      if (!betsResult?.result || !roundResult?.result) continue

      const bets = betsResult.result as unknown as readonly bigint[]

      // getRoundState returns a struct — viem decodes as object with named fields
      const round = roundResult.result as unknown as {
        roundId: bigint
        totalPool: bigint
        winningBucket: number
        settled: boolean
        cancelled: boolean
      }

      const isClaimed = (claimedResult?.result as unknown as boolean) ?? false

      let userTotalInRound = 0n
      for (let b = 0; b < bets.length; b++) {
        if (bets[b] > 0n) {
          userTotalInRound += bets[b]
          totalBets++
          recentBets.push({ roundId, bucket: b, amount: bets[b] })
        }
      }

      if (userTotalInRound > 0n) {
        totalBetAmount += userTotalInRound
        betRoundIds.push(roundId)

        if (isClaimed) {
          claimedRoundIds.add(roundId)
          winCount++
        }

        // Track won rounds (claimed or unclaimed) for payout calc
        if (round.settled && !round.cancelled) {
          const wb = Number(round.winningBucket)
          if (bets[wb] > 0n) {
            won.push({ roundId, userBetOnWinner: bets[wb], totalPool: round.totalPool, winningBucket: wb })
          }
        }
      }
    }

    recentBets.sort((a, b) => b.roundId - a.roundId)
    const uniqueRounds = betRoundIds.length
    const winRate = uniqueRounds > 0 ? (winCount / uniqueRounds) * 100 : 0

    return {
      intermediateStats: {
        totalBets,
        totalBetAmount,
        winCount,
        winRate,
        recentBets: recentBets.slice(0, 20),
        betRoundIds,
        claimedRoundIds,
      },
      wonRounds: won,
    }
  }, [phase1Data, roundIds])

  // Step 4: Second multicall — bucketDeposits for won rounds + fee
  const phase2Contracts = useMemo(() => {
    if (wonRounds.length === 0) return []
    return [
      { ...CONTRACT, functionName: 'PROTOCOL_FEE_BPS' as const, args: [] as const },
      ...wonRounds.map((w) => ({
        ...CONTRACT,
        functionName: 'bucketDeposits' as const,
        args: [BigInt(w.roundId), w.winningBucket] as const,
      })),
    ]
  }, [wonRounds])

  const { data: phase2Data } = useReadContracts({
    contracts: phase2Contracts,
    query: { enabled: phase2Contracts.length > 0, staleTime: 30_000 },
  })

  // Step 5: Final stats with totalWon calculated
  const stats = useMemo<UserStats | null>(() => {
    if (!intermediateStats) return null

    let totalWon = 0n

    if (phase2Data && phase2Data.length > 0 && wonRounds.length > 0) {
      const feeBps = (phase2Data[0]?.result as unknown as bigint) ?? 300n
      for (let i = 0; i < wonRounds.length; i++) {
        const w = wonRounds[i]
        const bucketTotal = (phase2Data[i + 1]?.result as unknown as bigint) ?? 0n
        if (bucketTotal > 0n) {
          const payout =
            (w.userBetOnWinner * w.totalPool * (10000n - feeBps)) /
            (bucketTotal * 10000n)
          totalWon += payout
        }
      }
    }

    return {
      ...intermediateStats,
      totalWon,
      netProfit: totalWon - intermediateStats.totalBetAmount,
    }
  }, [intermediateStats, phase2Data, wonRounds])

  // Loading: true while any step in the chain is still fetching
  const loading = enabled && (roundIdLoading || phase1Loading || (currentRoundId != null && !phase1Data && phase1Contracts.length > 0))

  return { stats, loading, userAddress }
}

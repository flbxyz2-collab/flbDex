
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { TAPGRID_ABI, TAPGRID_ADDRESS } from '../../lib/surge/contracts'

interface RoundState {
  settled: boolean
  cancelled: boolean
  winningBucket: number
}

export function useClaimableRounds(
  betRoundIds: number[],
  claimedRoundIds: Set<number>,
  userAddress: `0x${string}` | undefined,
) {
  // Build batch read contracts: for each unclaimed round, read getRoundState + getUserBets
  const unclaimed = useMemo(
    () => betRoundIds.filter((id) => !claimedRoundIds.has(id)),
    [betRoundIds, claimedRoundIds],
  )

  const contracts = useMemo(() => {
    if (!userAddress || unclaimed.length === 0) return []
    return unclaimed.flatMap((roundId) => [
      {
        address: TAPGRID_ADDRESS,
        abi: TAPGRID_ABI,
        functionName: 'getRoundState' as const,
        args: [BigInt(roundId)] as const,
      },
      {
        address: TAPGRID_ADDRESS,
        abi: TAPGRID_ABI,
        functionName: 'getUserBets' as const,
        args: [BigInt(roundId), userAddress] as const,
      },
    ])
  }, [userAddress, unclaimed])

  const { data } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 15_000 },
  })

  const claimableRoundIds = useMemo(() => {
    if (!data || unclaimed.length === 0) return []
    const result: number[] = []

    for (let i = 0; i < unclaimed.length; i++) {
      const roundResult = data[i * 2]
      const betsResult = data[i * 2 + 1]

      if (roundResult?.result && betsResult?.result) {
        const round = roundResult.result as unknown as RoundState
        if (round.settled && !round.cancelled) {
          const bets = betsResult.result as readonly bigint[]
          const winningBucket = Number(round.winningBucket)
          if (bets[winningBucket] > 0n) {
            result.push(unclaimed[i])
          }
        }
      }
    }

    return result
  }, [data, unclaimed])

  return { claimableRoundIds }
}

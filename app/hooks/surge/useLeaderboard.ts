
import { useEffect, useState } from 'react'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from '../../lib/surge/chains'
import { TAPGRID_ABI, TAPGRID_ADDRESS } from '../../lib/surge/contracts'

export interface LeaderboardEntry {
  address: string
  totalBet: bigint
  totalWon: bigint
  netProfit: bigint
  betCount: number
  winCount: number
}

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'),
})

interface EventLog {
  args: Record<string, unknown>
  blockNumber: bigint
}

async function fetchEventsChunked(
  eventName: 'BetPlaced' | 'WinningsClaimed',
  fromBlock: bigint,
  toBlock: bigint,
): Promise<EventLog[]> {
  const allLogs: EventLog[] = []
  const CHUNK = 500n
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n
    try {
      const logs = await client.getContractEvents({
        address: TAPGRID_ADDRESS,
        abi: TAPGRID_ABI,
        eventName,
        fromBlock: start,
        toBlock: end,
      })
      allLogs.push(...(logs as unknown as EventLog[]))
    } catch {
      // Skip failed chunks
    }
  }
  return allLogs
}

export function useLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchLeaderboard() {
      try {
        const currentBlock = await client.getBlockNumber()
        const fromBlock = currentBlock > 10000n ? currentBlock - 10000n : 0n

        const [betLogs, claimLogs] = await Promise.all([
          fetchEventsChunked('BetPlaced', fromBlock, currentBlock),
          fetchEventsChunked('WinningsClaimed', fromBlock, currentBlock),
        ])

        if (cancelled) return

        const userMap = new Map<string, LeaderboardEntry>()

        const getOrCreate = (addr: string): LeaderboardEntry => {
          let entry = userMap.get(addr)
          if (!entry) {
            entry = {
              address: addr,
              totalBet: 0n,
              totalWon: 0n,
              netProfit: 0n,
              betCount: 0,
              winCount: 0,
            }
            userMap.set(addr, entry)
          }
          return entry
        }

        for (const log of betLogs) {
          const user = String(log.args.user)
          const amount = BigInt(log.args.amount as bigint)
          const entry = getOrCreate(user)
          entry.totalBet += amount
          entry.betCount += 1
        }

        for (const log of claimLogs) {
          const user = String(log.args.user)
          const amount = BigInt(log.args.amount as bigint)
          const entry = getOrCreate(user)
          entry.totalWon += amount
          entry.winCount += 1
        }

        for (const entry of userMap.values()) {
          entry.netProfit = entry.totalWon - entry.totalBet
        }

        const sorted = Array.from(userMap.values())
          .sort((a, b) => {
            if (b.netProfit > a.netProfit) return 1
            if (b.netProfit < a.netProfit) return -1
            return 0
          })
          .slice(0, 50)

        if (!cancelled) {
          setEntries(sorted)
          setLoading(false)
        }
      } catch (err) {
        console.error('[leaderboard] Failed to fetch events:', (err as Error).message.slice(0, 200))
        if (!cancelled) setLoading(false)
      }
    }

    fetchLeaderboard()
    return () => {
      cancelled = true
    }
  }, [])

  return { entries, loading }
}

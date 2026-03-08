import { createPublicClient, createWalletClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { TAPGRID_ABI } from './abi'
import * as state from './state'
import * as priceModule from './price'
import { startKeeper, stopKeeper, pruneSeededRounds } from './keeper'
import type { ServerMessage, CachedRound } from './types'

// ─── Config ───
const TAPGRID_ADDRESS = process.env.NEXT_PUBLIC_TAPGRID_ADDRESS as `0x${string}`
const RPC_URL = process.env.ALCHEMY_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
const RAW_KEEPER_KEY = process.env.KEEPER_PRIVATE_KEY
const KEEPER_KEY = RAW_KEEPER_KEY
  ? (RAW_KEEPER_KEY.startsWith('0x') ? RAW_KEEPER_KEY : `0x${RAW_KEEPER_KEY}`) as `0x${string}`
  : undefined
const PORT = Number(process.env.PORT ?? 8080)

// ─── Contract constants (must match TapGrid.sol) ───
const LOCK_BEFORE_END = 30
const BUCKET_SIZE = 2_000_000_000_000_000_000n // $2 in 18 decimals

// ─── Validate env ───
if (!TAPGRID_ADDRESS) {
  throw new Error('NEXT_PUBLIC_TAPGRID_ADDRESS is required')
}
if (!process.env.NEXT_PUBLIC_STORK_ADDRESS) {
  throw new Error('NEXT_PUBLIC_STORK_ADDRESS is required')
}
if (!process.env.STORK_API_TOKEN) {
  throw new Error('STORK_API_TOKEN is required (Stork off-chain REST API token)')
}

// ─── Create viem clients ───
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
  pollingInterval: 2_000, // Match Base's 2s block time for faster event detection
})

// Keeper wallet (optional — server still works for price relay without it)
let walletClient: ReturnType<typeof createWalletClient> | null = null
if (KEEPER_KEY) {
  const account = privateKeyToAccount(KEEPER_KEY)
  walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  })
  console.log(`[keeper] Wallet: ${account.address}`)
} else {
  console.warn('[keeper] No KEEPER_PRIVATE_KEY set — keeper disabled (price relay still works)')
}

// ─── WS Broadcasting ───
const TOPIC = 'tapgrid'
let clientCount = 0

function broadcast(message: ServerMessage): void {
  server.publish(TOPIC, JSON.stringify(message))
}

// ─── Lock notification tracking ───
const lockedNotified = new Set<number>()

// ─── Event watchers ───
function startEventWatchers(): void {
  const client = publicClient

  // Watch BetPlaced
  client.watchContractEvent({
    address: TAPGRID_ADDRESS,
    abi: TAPGRID_ABI,
    eventName: 'BetPlaced',
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { roundId: bigint; bucket: number; user: `0x${string}`; amount: bigint }
        const roundId = Number(args.roundId)
        const bucket = Number(args.bucket)

        state.updateFromBetPlaced(roundId, bucket, args.amount)

        const round = state.getRound(roundId)
        if (round) {
          broadcast({
            type: 'cell_update',
            roundId,
            bucket,
            totalDeposit: round.bucketDeposits[bucket].toString(),
            columnTotal: round.totalPool.toString(),
          })
        }
      }
    },
  })

  // Watch RoundCreated
  client.watchContractEvent({
    address: TAPGRID_ADDRESS,
    abi: TAPGRID_ABI,
    eventName: 'RoundCreated',
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { roundId: bigint; startTime: number; endTime: number; basePrice: bigint }
        const roundId = Number(args.roundId)
        const endTime = Number(args.endTime)
        const startTime = Number(args.startTime)

        // Only add if not already in state (keeper may have already added it)
        if (!state.getRound(roundId)) {
          state.addRound({
            roundId,
            basePrice: args.basePrice,
            bucketSize: BUCKET_SIZE,
            startTime,
            lockTime: endTime - LOCK_BEFORE_END,
            endTime,
            totalPool: 0n,
            bucketDeposits: Array(10).fill(0n),
            settlementPrice: 0n,
            winningBucket: 0,
            settled: false,
            cancelled: false,
          } as CachedRound)
        }

        broadcast({
          type: 'round_created',
          roundId,
          endTime,
          basePrice: args.basePrice.toString(),
        })
      }
    },
  })

  // Watch RoundSettled
  client.watchContractEvent({
    address: TAPGRID_ADDRESS,
    abi: TAPGRID_ABI,
    eventName: 'RoundSettled',
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { roundId: bigint; winningBucket: number; settlementPrice: bigint }
        const roundId = Number(args.roundId)

        state.updateFromRoundSettled(roundId, Number(args.winningBucket), args.settlementPrice)

        broadcast({
          type: 'round_settled',
          roundId,
          winningBucket: Number(args.winningBucket),
          settlementPrice: args.settlementPrice.toString(),
        })
      }
    },
  })

  // Watch RoundCancelled
  client.watchContractEvent({
    address: TAPGRID_ADDRESS,
    abi: TAPGRID_ABI,
    eventName: 'RoundCancelled',
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { roundId: bigint }
        const roundId = Number(args.roundId)

        state.updateFromRoundCancelled(roundId)
        broadcast({ type: 'round_cancelled', roundId })
      }
    },
  })

  console.log('[events] Contract event watchers started')
}

// ─── Periodic timers ───
function startTimers(): void {
  // Lock checker — every 1s
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000)
    for (const round of state.getAllActiveRounds()) {
      if (!round.settled && !round.cancelled && now >= round.lockTime && now < round.endTime) {
        if (!lockedNotified.has(round.roundId)) {
          lockedNotified.add(round.roundId)
          broadcast({ type: 'round_locked', roundId: round.roundId })
        }
      }
    }
  }, 1000)

  // Full state reconciliation broadcast — every 10s
  setInterval(() => {
    broadcast({ type: 'grid_state', rounds: state.getFullGridState() })
  }, 10_000)

  // Prune old rounds — every 60s
  setInterval(() => {
    state.pruneOldRounds()
    pruneSeededRounds()
    // Also clean up lock notification set
    const now = Math.floor(Date.now() / 1000)
    for (const id of lockedNotified) {
      const round = state.getRound(id)
      if (!round || round.endTime < now - 120) {
        lockedNotified.delete(id)
      }
    }
  }, 60_000)
}

// ─── Bun WebSocket Server ───
const server = Bun.serve({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          clients: clientCount,
          rounds: state.getRoundCount(),
          latestPrice: priceModule.getLatestPrice(),
          keeperEnabled: !!walletClient,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      )
    }

    // WebSocket upgrade on /ws or /
    if (url.pathname === '/ws' || url.pathname === '/') {
      const upgraded = server.upgrade(req)
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      return undefined
    }

    return new Response('TapGrid WS Server', { status: 200 })
  },

  websocket: {
    open(ws) {
      ws.subscribe(TOPIC)
      clientCount++

      // Hydrate with full grid state
      const gridState = state.getFullGridState()
      ws.send(JSON.stringify({ type: 'grid_state', rounds: gridState }))

      // Send latest price
      const price = priceModule.getLatestPrice()
      if (price) {
        ws.send(JSON.stringify({ type: 'price', ...price }))
      }

      console.log(`[ws] Client connected (total: ${clientCount})`)
    },

    message(_ws, _message) {
      // No client-to-server messages expected yet
    },

    close(ws) {
      ws.unsubscribe(TOPIC)
      clientCount--
      console.log(`[ws] Client disconnected (total: ${clientCount})`)
    },

    idleTimeout: 120,
    maxPayloadLength: 64 * 1024,
  },
})

// ─── Main startup ───
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════')
  console.log('  TapGrid WebSocket Server Starting...')
  console.log('═══════════════════════════════════════')
  console.log(`[config] TapGrid: ${TAPGRID_ADDRESS}`)
  console.log(`[config] RPC: ${RPC_URL}`)
  console.log(`[config] Chain: Base Sepolia (84532)`)

  // 1. Load state from chain
  console.log('[state] Loading grid state from chain...')
  await state.loadFromChain(publicClient as any)
  console.log(`[state] Loaded ${state.getRoundCount()} rounds`)

  // 2. Start Stork price poller
  priceModule.startPricePoller(publicClient as any, (price, timestamp) => {
    broadcast({ type: 'price', price, timestamp })
  })
  console.log('[price] Stork off-chain price poller started (1s interval)')

  // 3. Start keeper (if key is set)
  if (walletClient) {
    startKeeper(publicClient as any, walletClient as any)
    console.log('[keeper] Keeper started (2s interval)')
  }

  // 4. Start event watchers
  startEventWatchers()

  // 5. Start periodic timers
  startTimers()

  console.log('═══════════════════════════════════════')
  console.log(`  WebSocket server on ws://localhost:${server.port}`)
  console.log(`  Health check: http://localhost:${server.port}/health`)
  console.log('═══════════════════════════════════════')
}

main().catch((err) => {
  console.error('[fatal] Startup error:', err)
  process.exit(1)
})

// ─── Graceful shutdown ───
let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[shutdown] ${signal} received — shutting down gracefully...`)
  await stopKeeper()
  console.log('[shutdown] Done. Exiting.')
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

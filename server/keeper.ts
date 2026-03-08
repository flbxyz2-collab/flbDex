import type { PublicClient, WalletClient } from 'viem'
import { TAPGRID_ABI, ERC20_ABI, STORK_ABI } from './abi'
import * as state from './state'
import { getLatestPriceBigInt, getLatestSignedUpdate } from './price'

const TAPGRID_ADDRESS = process.env.NEXT_PUBLIC_TAPGRID_ADDRESS as `0x${string}`
const STORK_ADDRESS = process.env.NEXT_PUBLIC_STORK_ADDRESS as `0x${string}`
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`
const KEEPER_INTERVAL = 2000 // 2 seconds
const ROUND_INTERVAL = 300  // 5 minutes (must match TapGrid.sol)
const TARGET_FUTURE_ROUNDS = 8
const BUCKET_SIZE = 2_000_000_000_000_000_000n // $2 in 18 decimals (must match deploy)

// ─── Seed liquidity config ───
const SEED_ENABLED = process.env.SEED_ENABLED !== 'false'
const SEED_USDC_PER_ROUND = BigInt(process.env.SEED_USDC_PER_ROUND ?? '5000000') // 5 USDC (6 decimals)

const seededRounds = new Set<number>()
const claimedRounds = new Set<number>()

let keeperBusy = false
let keeperTimer: ReturnType<typeof setInterval> | null = null

// Track the latest end time we've created to avoid race with async event watcher
let lastCreatedEndTime = 0

export function startKeeper(
  publicClient: PublicClient,
  walletClient: WalletClient,
): void {
  async function tick() {
    if (keeperBusy) return
    keeperBusy = true

    try {
      await settleExpiredRounds(publicClient, walletClient)
      await createRoundsIfNeeded(publicClient, walletClient)
      await seedNewRounds(publicClient, walletClient)
      await claimKeeperWinnings(publicClient, walletClient)
    } catch (err) {
      console.error('[keeper] Unexpected error:', (err as Error).message)
    } finally {
      keeperBusy = false
    }
  }

  keeperTimer = setInterval(tick, KEEPER_INTERVAL)
  // Run immediately on start
  tick()
}

export async function stopKeeper(): Promise<void> {
  if (keeperTimer) {
    clearInterval(keeperTimer)
    keeperTimer = null
  }
  // Wait for any in-flight tick to finish so pending txs get confirmed
  if (keeperBusy) {
    console.log('[keeper] Waiting for in-flight tick to finish...')
    const start = Date.now()
    while (keeperBusy && Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 250))
    }
    if (keeperBusy) {
      console.warn('[keeper] Timed out waiting for tick — pending tx may be stuck')
    } else {
      console.log('[keeper] In-flight tick finished cleanly')
    }
  }
}

// Track when we last pushed a price on-chain (ms). Used to avoid re-pushing every tick.
let lastPushTime = 0

async function pushStorkPriceOnChain(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<boolean> {
  const signedUpdate = getLatestSignedUpdate()
  if (!signedUpdate) {
    console.warn('[keeper] No signed Stork update available to push on-chain')
    return false
  }

  const updateData = [
    {
      temporalNumericValue: {
        timestampNs: signedUpdate.timestampNs,
        quantizedValue: signedUpdate.quantizedValue,
      },
      id: signedUpdate.id,
      publisherMerkleRoot: signedUpdate.publisherMerkleRoot,
      valueComputeAlgHash: signedUpdate.valueComputeAlgHash,
      r: signedUpdate.r,
      s: signedUpdate.s,
      v: signedUpdate.v,
    },
  ]

  try {
    // Calculate the required fee
    const fee = await publicClient.readContract({
      address: STORK_ADDRESS,
      abi: STORK_ABI,
      functionName: 'getUpdateFeeV1',
      args: [updateData],
    }) as bigint

    const { request } = await publicClient.simulateContract({
      address: STORK_ADDRESS,
      abi: STORK_ABI,
      functionName: 'updateTemporalNumericValuesV1',
      args: [updateData],
      value: fee,
      account: walletClient.account!,
    })

    const hash = await walletClient.writeContract(request)
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`[keeper] Pushed Stork price on-chain — tx: ${hash}`)
    return true
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('NoFreshUpdate')) {
      // Price already on-chain is fresher, that's fine
      return true
    }
    console.warn('[keeper] Failed to push Stork price on-chain:', msg.slice(0, 200))
    return false
  }
}

async function settleExpiredRounds(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const expired = state.getUnsettledExpiredRounds(now)

  if (expired.length === 0) return

  // Skip junk rounds: if a round lasted less than 60s (start to end), it was created
  // by the rapid-fire bug. Mark them cancelled locally so we stop wasting gas.
  const junk = expired.filter((r) => (r.endTime - r.startTime) < 60)
  for (const r of junk) {
    console.log(`[keeper] Skipping junk round ${r.roundId} (duration: ${r.endTime - r.startTime}s) — marking cancelled locally`)
    state.updateFromRoundCancelled(r.roundId)
  }

  // Re-filter after skipping junk
  const valid = expired.filter((r) => (r.endTime - r.startTime) >= 60 && !r.cancelled)
  if (valid.length === 0) return

  // Ensure a fresh price is on-chain before settling.
  // If we haven't pushed recently, push now and skip settlement this tick
  // to give RPC nodes time to sync. Next tick we'll proceed to settle.
  const now_ms = Date.now()
  if (now_ms - lastPushTime > 30_000) {
    const pushed = await pushStorkPriceOnChain(publicClient, walletClient)
    if (!pushed) return
    lastPushTime = Date.now()
    return
  }

  // Settle only the oldest expired round per tick to avoid nonce conflicts
  const round = valid[0]

  try {
    const { request } = await publicClient.simulateContract({
      address: TAPGRID_ADDRESS,
      abi: TAPGRID_ABI,
      functionName: 'settleRound',
      args: [BigInt(round.roundId)],
      account: walletClient.account!,
    })

    const hash = await walletClient.writeContract({ ...request, gas: 500_000n })
    console.log(`[keeper] Settled round ${round.roundId} — tx: ${hash}`)

    // Wait for receipt so the nonce is confirmed before any subsequent tx
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('Already finished')) {
      console.log(`[keeper] Round ${round.roundId} already finished, updating state`)
      // Re-read from chain to sync state
      try {
        const onChain = await publicClient.readContract({
          address: TAPGRID_ADDRESS,
          abi: TAPGRID_ABI,
          functionName: 'getRoundState',
          args: [BigInt(round.roundId)],
        }) as {
          settled: boolean
          cancelled: boolean
          winningBucket: number
          settlementPrice: bigint
        }
        if (onChain.settled) {
          state.updateFromRoundSettled(round.roundId, Number(onChain.winningBucket), onChain.settlementPrice)
        } else if (onChain.cancelled) {
          state.updateFromRoundCancelled(round.roundId)
        }
      } catch {
        // If re-read fails, just mark cancelled to avoid retrying
        state.updateFromRoundCancelled(round.roundId)
      }
    } else if (msg.includes('Price too stale')) {
      console.warn(`[keeper] Stork price too stale for round ${round.roundId}, will retry`)
    } else if (msg.includes('Too early')) {
      // Block timestamp hasn't caught up yet, skip
    } else {
      console.error(`[keeper] Failed to settle round ${round.roundId}:`, msg.slice(0, 200))
    }
  }
}

async function createRoundsIfNeeded(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)

  // Don't create more rounds if too many unsettled expired rounds are pending
  const unsettled = state.getUnsettledExpiredRounds(now)
  if (unsettled.length > 2) return

  // Use the higher of state (from event watcher) and our local tracker (prevents race condition)
  const latestEndTime = Math.max(state.getLatestRoundEndTime(), lastCreatedEndTime)
  const futureBuffer = latestEndTime - now

  if (futureBuffer >= TARGET_FUTURE_ROUNDS * ROUND_INTERVAL) {
    return // enough future rounds
  }

  // Guard: if we recently created rounds and the tracker is still in the future, skip.
  // This prevents rapid-fire round creation while waiting for event watcher to catch up.
  if (lastCreatedEndTime > 0 && lastCreatedEndTime > now) {
    return
  }

  const roundsToCreate = Math.min(
    TARGET_FUTURE_ROUNDS,
    Math.ceil((TARGET_FUTURE_ROUNDS * ROUND_INTERVAL - Math.max(0, futureBuffer)) / ROUND_INTERVAL),
  )

  if (roundsToCreate <= 0) return

  // Get current Stork price for basePrice
  const priceBigInt = getLatestPriceBigInt()
  if (priceBigInt === 0n) {
    console.warn('[keeper] No Stork price available, skipping round creation')
    return
  }

  // Set the tracker BEFORE sending the tx to prevent re-entry on the next tick
  lastCreatedEndTime = now + roundsToCreate * ROUND_INTERVAL

  try {
    const { request } = await publicClient.simulateContract({
      address: TAPGRID_ADDRESS,
      abi: TAPGRID_ABI,
      functionName: 'createRounds',
      args: [BigInt(roundsToCreate), priceBigInt, BUCKET_SIZE],
      account: walletClient.account!,
    })

    const hash = await walletClient.writeContract({ ...request, gas: 2_000_000n })
    console.log(`[keeper] Created ${roundsToCreate} rounds — basePrice: ${priceBigInt} — tx: ${hash}`)

    // Wait for confirmation to prevent nonce issues on next tick
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (err) {
    // Reset tracker on failure so we retry on next tick
    lastCreatedEndTime = 0
    console.error('[keeper] Failed to create rounds:', (err as Error).message.slice(0, 200))
  }
}

// ═══════════════════════════════ SEED LIQUIDITY ═══════════════════════════════

async function seedNewRounds(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<void> {
  if (!SEED_ENABLED) return

  const now = Math.floor(Date.now() / 1000)

  // Find open, unseeded rounds that haven't ended and have no deposits yet
  // Skip junk rounds (duration < 60s = created by rapid-fire bug)
  const unseeded = state.getAllActiveRounds().filter((r) =>
    !r.settled &&
    !r.cancelled &&
    r.endTime > now &&
    now >= r.startTime &&
    r.totalPool === 0n &&
    !seededRounds.has(r.roundId) &&
    (r.endTime - r.startTime) >= 60
  )

  if (unseeded.length === 0) return

  // Check keeper USDC balance
  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletClient.account!.address],
  }) as bigint

  if (usdcBalance < SEED_USDC_PER_ROUND) {
    console.warn(`[seed] Keeper USDC balance ${usdcBalance} too low to seed (need ${SEED_USDC_PER_ROUND})`)
    return
  }

  // Seed one round per tick to stay responsive
  const round = unseeded[0]

  console.log(`[seed] Seeding round ${round.roundId} with ${SEED_USDC_PER_ROUND} USDC (6 decimals)`)

  try {
    // 1. Check and set USDC allowance for TapGrid contract
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [walletClient.account!.address, TAPGRID_ADDRESS],
    }) as bigint

    if (allowance < SEED_USDC_PER_ROUND) {
      const { request: approveReq } = await publicClient.simulateContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [TAPGRID_ADDRESS, SEED_USDC_PER_ROUND * 100n], // approve 100x to reduce future approvals
        account: walletClient.account!,
      })
      const approveHash = await walletClient.writeContract({ ...approveReq, gas: 100_000n })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      console.log(`[seed] USDC approved for TapGrid`)
    }

    // 2. Call seedRound — contract handles Gaussian distribution on-chain
    const { request } = await publicClient.simulateContract({
      address: TAPGRID_ADDRESS,
      abi: TAPGRID_ABI,
      functionName: 'seedRound',
      args: [BigInt(round.roundId), SEED_USDC_PER_ROUND],
      account: walletClient.account!,
    })

    const hash = await walletClient.writeContract({ ...request, gas: 500_000n })
    await publicClient.waitForTransactionReceipt({ hash })

    seededRounds.add(round.roundId)
    console.log(`[seed] Round ${round.roundId} seeded successfully`)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('locked') || msg.includes('Already finished') || msg.includes('Round finished') || msg.includes('Already seeded')) {
      seededRounds.add(round.roundId)
      console.log(`[seed] Round ${round.roundId} locked/finished/seeded, skipping`)
    } else {
      console.error(`[seed] Failed to seed round ${round.roundId}:`, msg.slice(0, 200))
    }
  }
}

// ═══════════════════════════════ AUTO-CLAIM ═══════════════════════════════

async function claimKeeperWinnings(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<void> {
  if (!SEED_ENABLED) return

  // Find settled rounds that we seeded but haven't claimed
  const claimable: number[] = []
  for (const roundId of seededRounds) {
    if (claimedRounds.has(roundId)) continue
    const round = state.getRound(roundId)
    if (round && (round.settled || round.cancelled)) {
      claimable.push(roundId)
    }
  }

  if (claimable.length === 0) return

  // Claim one per tick to stay responsive
  const roundId = claimable[0]

  try {
    const { request } = await publicClient.simulateContract({
      address: TAPGRID_ADDRESS,
      abi: TAPGRID_ABI,
      functionName: 'claimWinnings',
      args: [BigInt(roundId)],
      account: walletClient.account!,
    })

    const hash = await walletClient.writeContract({ ...request, gas: 300_000n })
    await publicClient.waitForTransactionReceipt({ hash })

    claimedRounds.add(roundId)
    console.log(`[seed] Claimed round ${roundId}`)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('Already claimed')) {
      claimedRounds.add(roundId)
    } else if (msg.includes('Not a winner') || msg.includes('Nothing to refund')) {
      // Shouldn't happen since we seed all buckets, but handle gracefully
      claimedRounds.add(roundId)
      console.log(`[seed] Round ${roundId} nothing to claim, skipping`)
    } else {
      console.error(`[seed] Failed to claim round ${roundId}:`, msg.slice(0, 200))
    }
  }
}

// ─── Cleanup ───

export function pruneSeededRounds(): void {
  const now = Math.floor(Date.now() / 1000)
  for (const roundId of seededRounds) {
    const round = state.getRound(roundId)
    if (!round || round.endTime < now - 120) {
      seededRounds.delete(roundId)
      claimedRounds.delete(roundId)
    }
  }
  // Also clean claimed set for rounds no longer in seeded
  for (const roundId of claimedRounds) {
    if (!seededRounds.has(roundId)) {
      claimedRounds.delete(roundId)
    }
  }
}

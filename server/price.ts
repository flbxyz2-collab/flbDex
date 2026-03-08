import type { PublicClient } from 'viem'

const STORK_API_URL = 'https://rest.jp.stork-oracle.network/v1/prices/latest'
const STORK_API_TOKEN = process.env.STORK_API_TOKEN as string
const STORK_ASSET = 'ETHUSD'

const BASE_POLL_INTERVAL = 1000  // 1s — real-time feel
const MAX_POLL_INTERVAL = 15_000 // 15s backoff ceiling on repeated failures

let latestPrice: { price: number; timestamp: number } | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let currentInterval = BASE_POLL_INTERVAL
let consecutiveFailures = 0

export function getLatestPrice(): { price: number; timestamp: number } | null {
  return latestPrice
}

export function getLatestPriceBigInt(): bigint {
  return latestPriceBigInt
}

let latestPriceBigInt: bigint = 0n

// Cached signed price data for the keeper to push on-chain before settlement
let latestSignedUpdate: StorkSignedUpdate | null = null

export interface StorkSignedUpdate {
  timestampNs: bigint
  quantizedValue: bigint
  id: `0x${string}`
  publisherMerkleRoot: `0x${string}`
  valueComputeAlgHash: `0x${string}`
  r: `0x${string}`
  s: `0x${string}`
  v: number
}

export function getLatestSignedUpdate(): StorkSignedUpdate | null {
  return latestSignedUpdate
}

export function startPricePoller(
  _publicClient: PublicClient,
  onPrice: (price: number, timestamp: number) => void,
): void {
  let active = true

  async function poll() {
    try {
      const res = await fetch(`${STORK_API_URL}?assets=${STORK_ASSET}`, {
        headers: { Authorization: `Basic ${STORK_API_TOKEN}` },
      })
      if (!res.ok) throw new Error(`Stork API returned ${res.status}`)

      // Parse as text first, then quote large integers (>15 digits) that would
      // lose precision as JS Numbers. Timestamps are nanosecond uint64 values
      // that exceed Number.MAX_SAFE_INTEGER.
      const rawText = await res.text()
      const safeText = rawText.replace(/"timestamp":\s*(\d{16,})/g, '"timestamp": "$1"')
      const json = JSON.parse(safeText) as {
        data: Record<string, {
          timestamp: string
          price: string
          stork_signed_price: {
            encoded_asset_id: string
            price: string
            timestamped_signature: {
              signature: { r: string; s: string; v: string }
              timestamp: string
              msg_hash: string
            }
            publisher_merkle_root: string
            calculation_alg: { checksum: string }
          }
        }>
      }

      const entry = json.data[STORK_ASSET]
      if (!entry) throw new Error(`No data for ${STORK_ASSET} in Stork response`)

      const priceStr = entry.stork_signed_price.price
      const priceBigInt = BigInt(priceStr)
      latestPriceBigInt = priceBigInt

      // Convert 18-decimal fixed point to float
      const priceFloat = Number(priceBigInt) / 1e18

      const wallTimestamp = Math.floor(Date.now() / 1000)
      latestPrice = { price: priceFloat, timestamp: wallTimestamp }
      onPrice(priceFloat, wallTimestamp)

      // Cache the signed update for on-chain push during settlement
      const sp = entry.stork_signed_price
      const hex = (v: string): `0x${string}` =>
        (v.startsWith('0x') ? v : `0x${v}`) as `0x${string}`

      latestSignedUpdate = {
        timestampNs: BigInt(sp.timestamped_signature.timestamp),
        quantizedValue: priceBigInt,
        id: hex(sp.encoded_asset_id),
        publisherMerkleRoot: hex(sp.publisher_merkle_root),
        valueComputeAlgHash: hex(sp.calculation_alg.checksum),
        r: hex(sp.timestamped_signature.signature.r),
        s: hex(sp.timestamped_signature.signature.s),
        v: Number(sp.timestamped_signature.signature.v),
      }

      // Reset backoff on success
      consecutiveFailures = 0
      currentInterval = BASE_POLL_INTERVAL
    } catch (err) {
      consecutiveFailures++
      currentInterval = Math.min(BASE_POLL_INTERVAL * Math.pow(2, consecutiveFailures), MAX_POLL_INTERVAL)
      console.warn(`[price] Failed to fetch Stork price (retry in ${currentInterval}ms):`, (err as Error).message)
    }

    // Schedule next poll
    if (active) {
      pollTimer = setTimeout(poll, currentInterval)
    }
  }

  // Start immediately
  poll()
}

export function stopPricePoller(): void {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

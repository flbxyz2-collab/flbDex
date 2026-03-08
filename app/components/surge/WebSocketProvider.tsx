
import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { ServerMessage, SerializedRound, PricePoint } from '../../lib/surge/types'
import { ROUND_DURATION, LOCK_BEFORE_END } from '../../lib/surge/constants'

interface WebSocketContextValue {
  connected: boolean
  price: number
  priceTimestamp: number
  roundsVersion: number
  getRounds: () => Map<number, SerializedRound>
  getPriceHistory: () => PricePoint[]
  subscribe: (handler: (msg: ServerMessage) => void) => () => void
}

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  price: 0,
  priceTimestamp: 0,
  roundsVersion: 0,
  getRounds: () => new Map(),
  getPriceHistory: () => [],
  subscribe: () => () => {},
})

export function useWebSocketContext() {
  return useContext(WebSocketContext)
}

const WS_URL = import.meta.env.VITE_SURGE_WS_URL ?? 'ws://localhost:8080'
const MAX_PRICE_HISTORY = 200
const RECONNECT_MAX_MS = 10_000

export default function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [price, setPrice] = useState(0)
  const [priceTimestamp, setPriceTimestamp] = useState(0)
  const [roundsVersion, setRoundsVersion] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const roundsRef = useRef<Map<number, SerializedRound>>(new Map())
  const priceHistoryRef = useRef<PricePoint[]>([])
  const subscribersRef = useRef<Set<(msg: ServerMessage) => void>>(new Set())
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(1000)
  const mountedRef = useRef(true)

  // Throttle price state updates
  const priceRafRef = useRef<number | null>(null)
  const pendingPriceRef = useRef<{ price: number; timestamp: number } | null>(null)

  const bumpVersion = useCallback(() => {
    setRoundsVersion((v) => v + 1)
  }, [])

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      // Notify subscribers
      subscribersRef.current.forEach((h) => h(msg))

      switch (msg.type) {
        case 'price': {
          // Append to history — deduplicate only if both time AND value are identical
          // (server now sends wall-clock timestamps, but two polls in the same second
          //  with different prices should both be recorded)
          const history = priceHistoryRef.current
          const last = history.length > 0 ? history[history.length - 1] : null
          if (!last || last.time !== msg.timestamp || last.value !== msg.price) {
            history.push({ time: msg.timestamp, value: msg.price })
            if (history.length > MAX_PRICE_HISTORY) {
              priceHistoryRef.current = history.slice(-MAX_PRICE_HISTORY)
            }
          }
          // Throttle state update via rAF
          pendingPriceRef.current = { price: msg.price, timestamp: msg.timestamp }
          if (priceRafRef.current === null) {
            priceRafRef.current = requestAnimationFrame(() => {
              const p = pendingPriceRef.current
              if (p) {
                setPrice(p.price)
                setPriceTimestamp(p.timestamp)
              }
              priceRafRef.current = null
            })
          }
          break
        }

        case 'grid_state': {
          const map = new Map<number, SerializedRound>()
          for (const round of msg.rounds) {
            map.set(round.roundId, round)
          }
          roundsRef.current = map
          bumpVersion()
          break
        }

        case 'cell_update': {
          const round = roundsRef.current.get(msg.roundId)
          if (round) {
            const deposits = [...round.bucketDeposits]
            deposits[msg.bucket] = msg.totalDeposit
            roundsRef.current.set(msg.roundId, {
              ...round,
              bucketDeposits: deposits,
              totalPool: msg.columnTotal,
            })
            bumpVersion()
          }
          break
        }

        case 'round_created': {
          const newRound: SerializedRound = {
            roundId: msg.roundId,
            basePrice: msg.basePrice,
            bucketSize: '0',
            startTime: 0,
            lockTime: msg.endTime - LOCK_BEFORE_END,
            endTime: msg.endTime,
            totalPool: '0',
            bucketDeposits: Array(10).fill('0'),
            settlementPrice: '0',
            winningBucket: 0,
            status: 'open',
            settled: false,
            cancelled: false,
          }
          // Try to get bucketSize from an existing round
          const existing = roundsRef.current.values().next().value as SerializedRound | undefined
          if (existing) {
            newRound.bucketSize = existing.bucketSize
            newRound.startTime = msg.endTime - ROUND_DURATION
          }
          roundsRef.current.set(msg.roundId, newRound)
          bumpVersion()
          break
        }

        case 'round_locked': {
          const round = roundsRef.current.get(msg.roundId)
          if (round) {
            roundsRef.current.set(msg.roundId, { ...round, status: 'locked' })
            bumpVersion()
          }
          break
        }

        case 'round_settled': {
          const round = roundsRef.current.get(msg.roundId)
          if (round) {
            roundsRef.current.set(msg.roundId, {
              ...round,
              status: 'settled',
              settled: true,
              winningBucket: msg.winningBucket,
              settlementPrice: msg.settlementPrice,
            })
            bumpVersion()
          }
          break
        }

        case 'round_cancelled': {
          const round = roundsRef.current.get(msg.roundId)
          if (round) {
            roundsRef.current.set(msg.roundId, {
              ...round,
              status: 'cancelled',
              cancelled: true,
            })
            bumpVersion()
          }
          break
        }
      }
    },
    [bumpVersion]
  )

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    try {
      const ws = new WebSocket(`${WS_URL}/ws`)

      ws.onopen = () => {
        setConnected(true)
        reconnectDelayRef.current = 1000
      }

      ws.onmessage = handleMessage

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        // Reconnect with backoff
        if (mountedRef.current) {
          const delay = reconnectDelayRef.current
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS)
            connect()
          }, delay)
        }
      }

      ws.onerror = () => {
        ws.close()
      }

      wsRef.current = ws
    } catch {
      // Failed to create WebSocket, retry
      if (mountedRef.current) {
        reconnectTimeoutRef.current = setTimeout(connect, reconnectDelayRef.current)
      }
    }
  }, [handleMessage])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (priceRafRef.current) cancelAnimationFrame(priceRafRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const getRounds = useCallback(() => roundsRef.current, [])
  const getPriceHistory = useCallback(() => priceHistoryRef.current, [])

  const subscribe = useCallback((handler: (msg: ServerMessage) => void) => {
    subscribersRef.current.add(handler)
    return () => {
      subscribersRef.current.delete(handler)
    }
  }, [])

  const value: WebSocketContextValue = {
    connected,
    price,
    priceTimestamp,
    roundsVersion,
    getRounds,
    getPriceHistory,
    subscribe,
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

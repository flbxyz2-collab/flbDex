
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useGridState } from '../../../hooks/surge/useGridState'
import { usePrice } from '../../../hooks/surge/usePrice'
import { useWebSocket } from '../../../hooks/surge/useWebSocket'
import { usePlaceBet } from '../../../hooks/surge/usePlaceBet'
import { NUM_BUCKETS, BET_AMOUNTS, DEFAULT_BUCKET_SIZE } from '../../../lib/surge/constants'
import { Skeleton } from '../ui/skeleton'
import PriceChart from './PriceChart'
import TimeAxis from './TimeAxis'
import ColumnStatus from './ColumnStatus'
import GridCell from './GridCell'
import WinOverlay from './WinOverlay'
import PriceBadge from '../PriceBadge'

const MIN_CELL_WIDTH = 56
const MAX_CELL_WIDTH = 120
const MIN_CELL_HEIGHT = 32
const TIME_STRIP_HEIGHT = 44 // TimeAxis (24px) + ColumnStatus (20px)

function formatPrice(p: number): string {
  if (p >= 100) return `$${p.toFixed(1)}`
  if (p >= 1) return `$${p.toFixed(3)}`
  return `$${p.toFixed(5)}`
}

export default function TapGrid() {
  const {
    columns,
    loading,
    currentPriceRow,
    selectedBetAmount,
    setSelectedBetAmount,
  } = useGridState()

  const { placeBet, isPending } = usePlaceBet()
  const { price, priceHistory } = usePrice()
  const { connected } = useWebSocket()
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridAreaRef = useRef<HTMLDivElement>(null)

  // Dynamic cell dimensions from container size
  const [cellWidth, setCellWidth] = useState(80)
  const [cellHeight, setCellHeight] = useState(48)

  useEffect(() => {
    const el = gridAreaRef.current
    if (!el) return

    const measure = () => {
      const h = el.clientHeight
      const w = el.clientWidth

      // Height: fill available space minus time strip at the bottom
      const availableHeight = h - TIME_STRIP_HEIGHT
      const computedHeight = Math.max(MIN_CELL_HEIGHT, Math.floor(availableHeight / NUM_BUCKETS))
      setCellHeight(computedHeight)

      // Width: gridAreaRef only measures the grid column (chart is a sibling)
      const visibleCols = Math.max(4, Math.min(8, columns.length || 6))
      const computedWidth = Math.min(MAX_CELL_WIDTH, Math.max(MIN_CELL_WIDTH, Math.floor(w / visibleCols)))
      setCellWidth(computedWidth)
    }

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()

    return () => ro.disconnect()
  }, [columns.length])

  // Ref so memo'd GridCell onTap always reads the latest bet amount
  const betAmountRef = useRef(selectedBetAmount)
  betAmountRef.current = selectedBetAmount

  // Get grid dimensions from first active column
  const refCol = useMemo(() => {
    return columns.find((c) => c.status === 'open' || c.status === 'locked') ?? columns[0]
  }, [columns])

  const basePrice = refCol?.basePrice ?? 0
  const bucketSize = refCol?.bucketSize ?? DEFAULT_BUCKET_SIZE

  // Price badge position on chart Y-axis
  const badgeTopPercent = useMemo(() => {
    if (!basePrice || !bucketSize) return 50
    const gridTop = basePrice + 5 * bucketSize
    const gridRange = NUM_BUCKETS * bucketSize || 0.001
    return Math.max(2, Math.min(98, ((gridTop - price) / gridRange) * 100))
  }, [basePrice, bucketSize, price])

  // Compute price labels for each row boundary (right edge overlay)
  const priceLabels = useMemo(() => {
    if (!basePrice || !bucketSize) return []
    const gridTop = basePrice + 5 * bucketSize
    return Array.from({ length: NUM_BUCKETS }, (_, i) => {
      const rowBoundary = gridTop - (i + 0.5) * bucketSize
      return {
        price: rowBoundary,
        label: formatPrice(rowBoundary),
        isCurrent: i === currentPriceRow,
      }
    })
  }, [basePrice, bucketSize, currentPriceRow])

  // Auto-scroll to keep current columns visible
  useEffect(() => {
    if (!scrollRef.current || columns.length === 0) return

    const firstOpenIdx = columns.findIndex((c) => c.status === 'open')
    if (firstOpenIdx < 0) return

    const targetScroll = Math.max(0, (firstOpenIdx - 1) * cellWidth)
    scrollRef.current.scrollTo({ left: targetScroll, behavior: 'smooth' })
  }, [columns.length, columns[0]?.roundId, cellWidth])

  // WinOverlay callback: check if user won
  const checkUserWin = useCallback(
    (roundId: number, winningBucket: number) => {
      const col = columns.find((c) => c.roundId === roundId)
      if (!col) return { won: false, amount: 0 }
      const cell = col.cells[winningBucket]
      if (!cell || cell.userBet === 0n) return { won: false, amount: 0 }

      const userBetFloat = Number(cell.userBet) / 1e6
      const depositFloat = Number(cell.deposit) / 1e6
      const poolFloat = Number(col.totalPool) / 1e6
      const share = depositFloat > 0 ? userBetFloat / depositFloat : 0
      const payout = share * poolFloat * 0.97

      return { won: true, amount: payout }
    },
    [columns]
  )

  const gridHeight = NUM_BUCKETS * cellHeight

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="flex flex-col gap-2 items-center">
          <div className="h-2 w-2 rounded-full bg-base-blue animate-pulse" />
          <span className="text-sm text-text-muted font-mono">
            {connected ? 'Loading grid...' : 'Connecting...'}
          </span>
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(6, 80px)` }}>
          {Array.from({ length: 60 }, (_, i) => (
            <Skeleton key={i} className="rounded-sm" style={{ width: 80, height: 48 }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Main body: Chart + Grid area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Price Chart (hidden on mobile) */}
        <div
          className="hidden md:flex md:w-[35%] lg:w-[40%] shrink-0 relative border-r border-border/30"
          style={{ height: gridHeight }}
        >
          <PriceChart
            priceHistory={priceHistory}
            currentPrice={price}
            height={gridHeight}
            numRows={NUM_BUCKETS}
            basePrice={basePrice}
            bucketSize={bucketSize}
          />
          {/* Floating price badge on chart */}
          <div
            className="absolute right-3 -translate-y-1/2 z-10"
            style={{ top: `${badgeTopPercent}%` }}
          >
            <PriceBadge price={price} />
          </div>
        </div>

        {/* Grid area: cells + time strip at bottom */}
        <div ref={gridAreaRef} className="flex flex-1 flex-col min-w-0 overflow-hidden">
          {/* Scrollable grid + time strip */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-x-auto overflow-y-hidden relative"
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Grid cells */}
            <div className="relative">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${columns.length}, ${cellWidth}px)`,
                  gridTemplateRows: `repeat(${NUM_BUCKETS}, ${cellHeight}px)`,
                }}
              >
                {Array.from({ length: NUM_BUCKETS }, (_, rowIdx) =>
                  columns.map((column) => {
                    const cell = column.cells[rowIdx]
                    if (!cell) return null
                    return (
                      <GridCell
                        key={`${column.roundId}-${rowIdx}`}
                        cell={cell}
                        columnStatus={column.status}
                        isCurrentPriceRow={rowIdx === currentPriceRow}
                        isWinningCell={
                          column.status === 'settled' && column.winningBucket === rowIdx
                        }
                        onTap={() => {
                          if (!isPending) {
                            placeBet(column.roundId, rowIdx, betAmountRef.current)
                          }
                        }}
                      />
                    )
                  })
                )}
              </div>

              {/* Price labels overlaid on right edge — sticky so they stay visible when scrolling */}
              <div
                className="absolute top-0 right-0 pointer-events-none"
                style={{ height: gridHeight }}
              >
                {priceLabels.map((label, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-end pr-1.5"
                    style={{ height: cellHeight }}
                  >
                    {label.isCurrent ? (
                      <span className="font-mono text-[10px] font-bold text-base-green bg-base-green/15 rounded px-1 py-0.5 leading-none">
                        {label.label}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-text-muted/60 leading-none">
                        {label.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Time axis + Column status — at the bottom, scrolls with grid */}
            <div className="shrink-0" style={{ width: columns.length * cellWidth }}>
              <TimeAxis columns={columns} cellWidth={cellWidth} />
              <div className="flex">
                {columns.map((col) => (
                  <ColumnStatus
                    key={col.roundId}
                    status={col.status}
                    endTime={col.endTime}
                    cellWidth={cellWidth}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar: bet amount selector + mobile price */}
      <div className="flex items-center justify-between border-t border-border/50 bg-card/80 backdrop-blur-sm px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2 md:hidden">
          <PriceBadge price={price} />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-text-muted mr-0.5">Tap cell to bet</span>
          <div className="flex items-center gap-1.5 rounded-lg bg-secondary/80 p-1">
            {BET_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => setSelectedBetAmount(amt)}
                className={`rounded-md px-3 py-1.5 font-mono text-xs font-bold transition-all ${
                  selectedBetAmount === amt
                    ? 'bg-base-blue text-white shadow-[0_0_12px_rgba(0,0,255,0.35)]'
                    : 'text-text-muted hover:text-text-secondary hover:bg-secondary'
                }`}
              >
                {amt}
              </button>
            ))}
          </div>
          <span className="text-xs font-mono font-bold text-base-light">USDC</span>
        </div>
      </div>

      {/* WinOverlay */}
      <WinOverlay checkUserWin={checkUserWin} />
    </div>
  )
}

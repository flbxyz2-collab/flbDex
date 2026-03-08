
import { memo } from 'react'
import { cn } from '../../../lib/surge/utils'
import BetCard from './BetCard'
import type { GridCell as GridCellType, RoundStatus } from '../../../lib/surge/types'

interface GridCellProps {
  cell: GridCellType
  columnStatus: RoundStatus
  isCurrentPriceRow: boolean
  isWinningCell: boolean
  onTap: () => void
}

function formatMultiplier(m: number): string {
  if (m === 0) return '--'
  if (m >= 100) return `${Math.round(m)}X`
  if (m >= 10) return `${m.toFixed(1)}X`
  return `${m.toFixed(2)}X`
}

function multiplierColor(m: number): string {
  if (m === 0) return 'text-text-muted/40'
  if (m < 3) return 'text-text-muted'
  if (m < 7) return 'text-text-secondary'
  if (m < 15) return 'text-base-light'
  return 'text-base-cyan animate-pulse'
}

function GridCellComponent({
  cell,
  columnStatus,
  isCurrentPriceRow,
  isWinningCell,
  onTap,
}: GridCellProps) {
  const isOpen = columnStatus === 'open'
  const isSettled = columnStatus === 'settled' || columnStatus === 'cancelled'
  const isLocked = columnStatus === 'locked'
  const isSettling = columnStatus === 'settling'
  const hasUserBet = cell.userBet > 0n
  const isLosingCell = isSettled && !isWinningCell

  return (
    <div
      onClick={isOpen ? onTap : undefined}
      className={cn(
        'relative flex items-center justify-center border border-border/40 transition-all duration-150 select-none',
        // Base
        'bg-grid',
        // Current price row highlight
        isCurrentPriceRow && !isSettled && 'bg-base-blue/10',
        // Hover + active tap feedback (open cells only)
        isOpen && 'cursor-pointer hover:bg-grid-hover hover:scale-[1.03] hover:border-base-blue/50 hover:shadow-[0_0_12px_rgba(0,0,255,0.15)] active:scale-95 active:bg-base-blue/20 active:border-base-blue/50',
        // Locked
        (isLocked || isSettling) && 'opacity-60 cursor-not-allowed',
        // Settled states
        isWinningCell && 'bg-base-cyan/15 border-base-cyan/40',
        isLosingCell && 'opacity-20',
      )}
    >
      {/* Multiplier text (hidden when user has bet) */}
      {!hasUserBet && (
        <span
          className={cn(
            'font-mono text-xs font-semibold leading-none',
            multiplierColor(cell.multiplier)
          )}
        >
          {formatMultiplier(cell.multiplier)}
        </span>
      )}

      {/* User bet overlay */}
      {hasUserBet && (
        <BetCard
          amount={cell.userBet}
          multiplier={cell.multiplier}
          isWinner={isWinningCell}
          isLoser={isLosingCell}
        />
      )}

      {/* Winning cell glow dot */}
      {isWinningCell && (
        <div className="absolute inset-0 rounded-sm bg-base-cyan/10 pointer-events-none" />
      )}
    </div>
  )
}

// Custom comparator for React.memo — only re-render when visual data changes
export default memo(GridCellComponent, (prev, next) => {
  if (prev.columnStatus !== next.columnStatus) return false
  if (prev.isCurrentPriceRow !== next.isCurrentPriceRow) return false
  if (prev.isWinningCell !== next.isWinningCell) return false
  if (prev.cell.userBet !== next.cell.userBet) return false
  if (prev.cell.deposit !== next.cell.deposit) return false
  // Multiplier tolerance: don't re-render for tiny changes
  if (Math.abs(prev.cell.multiplier - next.cell.multiplier) > 0.05) return false
  return true
})


import { cn } from '../../../lib/surge/utils'
import type { GridColumn } from '../../../lib/surge/types'

interface TimeAxisProps {
  columns: GridColumn[]
  cellWidth: number
}

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function TimeAxis({ columns, cellWidth }: TimeAxisProps) {
  return (
    <div className="flex h-6 shrink-0">
      {columns.map((col) => (
        <div
          key={col.roundId}
          className={cn(
            'flex items-center justify-center font-mono text-[10px] select-none',
            col.status === 'settling'
              ? 'text-base-pink font-semibold'
              : col.status === 'locked'
                ? 'text-base-yellow'
                : col.status === 'settled'
                  ? 'text-text-muted/50'
                  : 'text-text-muted'
          )}
          style={{ width: cellWidth }}
        >
          {formatTime(col.endTime)}
        </div>
      ))}
    </div>
  )
}

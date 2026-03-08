
import { cn } from '../../../lib/surge/utils'

interface PriceAxisProps {
  basePrice: number
  bucketSize: number
  numBuckets: number
  currentPriceRow: number
  cellHeight: number
}

function formatPrice(price: number): string {
  if (price >= 100) return `$${price.toFixed(2)}`
  if (price >= 1) return `$${price.toFixed(4)}`
  return `$${price.toFixed(6)}`
}

export default function PriceAxis({
  basePrice,
  bucketSize,
  numBuckets,
  currentPriceRow,
  cellHeight,
}: PriceAxisProps) {
  const gridTop = basePrice + 5 * bucketSize

  return (
    <div className="flex flex-col shrink-0" style={{ width: 76 }}>
      {Array.from({ length: numBuckets }, (_, i) => {
        // Center of bucket i
        const bucketCenter = gridTop - (i + 0.5) * bucketSize

        return (
          <div
            key={i}
            className={cn(
              'flex items-center justify-end pr-2 font-mono text-[11px] leading-none select-none',
              i === currentPriceRow
                ? 'text-base-cyan font-semibold'
                : 'text-text-muted'
            )}
            style={{ height: cellHeight }}
          >
            {formatPrice(bucketCenter)}
          </div>
        )
      })}
    </div>
  )
}

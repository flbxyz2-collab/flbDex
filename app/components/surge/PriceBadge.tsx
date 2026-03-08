
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../../lib/surge/utils'

function formatPrice(price: number): string {
  if (price >= 100) {
    return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (price >= 1) {
    return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 })
  }
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 6, maximumFractionDigits: 6 })
}

interface PriceBadgeProps {
  price: number
  className?: string
}

export default function PriceBadge({ price, className }: PriceBadgeProps) {
  const formatted = price > 0 ? formatPrice(price) : '$0.00'

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-base-cyan/30 bg-base-cyan/10 px-3 py-1 shadow-[0_0_12px_rgba(60,138,255,0.2)]',
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-base-cyan animate-pulse" />
      <AnimatePresence mode="wait">
        <motion.span
          key={formatted}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className="font-mono text-sm font-semibold text-base-cyan"
        >
          {formatted}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

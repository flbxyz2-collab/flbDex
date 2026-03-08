
import { motion } from 'framer-motion'
import { cn } from '../../../lib/surge/utils'

interface BetCardProps {
  amount: bigint
  multiplier: number
  isWinner?: boolean
  isLoser?: boolean
}

function formatMultiplier(m: number): string {
  if (m >= 100) return `${Math.round(m)}X`
  if (m >= 10) return `${m.toFixed(1)}X`
  return `${m.toFixed(2)}X`
}

export default function BetCard({ amount, multiplier, isWinner, isLoser }: BetCardProps) {
  const amountFloat = Number(amount) / 1e6
  const amountLabel = amountFloat >= 1
    ? `${amountFloat.toFixed(1)} USDC`
    : `${amountFloat.toFixed(2)} USDC`

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: isLoser ? 0.9 : 1,
        opacity: isLoser ? 0.3 : 1,
      }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className={cn(
        'absolute inset-1 z-10 flex flex-col items-center justify-center rounded-md',
        'bg-linear-to-br from-base-blue to-base-blue/80',
        'shadow-[0_0_16px_rgba(0,0,255,0.35)]',
        isWinner && 'border-2 border-base-cyan shadow-[0_0_20px_rgba(60,138,255,0.5)]',
        isLoser && 'shadow-none'
      )}
    >
      <motion.div
        animate={isLoser ? {} : { y: [0, -1.5, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
        className="flex flex-col items-center"
      >
        <span className="text-sm font-bold text-white leading-tight">
          {amountLabel}
        </span>
        <span className="text-[10px] font-mono text-white/80 leading-tight">
          {formatMultiplier(multiplier)}
        </span>
      </motion.div>
    </motion.div>
  )
}

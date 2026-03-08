
import { useState, useEffect } from 'react'
import { cn } from '../../../lib/surge/utils'
import type { RoundStatus } from '../../../lib/surge/types'

interface ColumnStatusProps {
  status: RoundStatus
  endTime: number
  cellWidth: number
}

export default function ColumnStatus({ status, endTime, cellWidth }: ColumnStatusProps) {
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    if (status !== 'locked' && status !== 'open') return

    const tick = () => {
      const remaining = Math.max(0, endTime - Math.floor(Date.now() / 1000))
      setCountdown(`${remaining}s`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [status, endTime])

  return (
    <div
      className="flex items-center justify-center gap-1 h-5 font-mono text-[10px] select-none"
      style={{ width: cellWidth }}
    >
      {status === 'open' && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-base-cyan" />
          <span className="text-base-cyan">{countdown}</span>
        </>
      )}
      {status === 'locked' && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-base-yellow animate-pulse" />
          <span className="text-base-yellow">{countdown}</span>
        </>
      )}
      {status === 'settling' && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-base-pink animate-pulse" />
          <span className="text-base-pink">SETTLING</span>
        </>
      )}
      {status === 'settled' && (
        <span className={cn('text-text-muted/50')}>DONE</span>
      )}
      {status === 'cancelled' && (
        <span className="text-text-muted/50">CANCELLED</span>
      )}
    </div>
  )
}

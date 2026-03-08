
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWebSocket } from '../../../hooks/surge/useWebSocket'
import { useClaimWinnings } from '../../../hooks/surge/useClaimWinnings'
import type { ServerMessage } from '../../../lib/surge/types'

interface WinEvent {
  roundId: number
  winningBucket: number
  userWon: boolean
  winAmount: number
  claimStatus: 'pending' | 'claiming' | 'claimed' | 'failed'
}

interface WinOverlayProps {
  checkUserWin: (roundId: number, winningBucket: number) => { won: boolean; amount: number }
}

export default function WinOverlay({ checkUserWin }: WinOverlayProps) {
  const { subscribe } = useWebSocket()
  const { claim } = useClaimWinnings()
  const [winEvent, setWinEvent] = useState<WinEvent | null>(null)
  const claimingRef = useRef(false)

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.type !== 'round_settled') return

      const result = checkUserWin(msg.roundId, msg.winningBucket)
      if (!result.won || result.amount <= 0) return

      setWinEvent({
        roundId: msg.roundId,
        winningBucket: msg.winningBucket,
        userWon: true,
        winAmount: result.amount,
        claimStatus: 'pending',
      })
    },
    [checkUserWin],
  )

  // Auto-claim when a win is detected
  useEffect(() => {
    if (!winEvent || winEvent.claimStatus !== 'pending' || claimingRef.current) return
    claimingRef.current = true

    setWinEvent((prev) => (prev ? { ...prev, claimStatus: 'claiming' } : null))

    claim(winEvent.roundId)
      .then(() => {
        setWinEvent((prev) => (prev ? { ...prev, claimStatus: 'claimed' } : null))
      })
      .catch(() => {
        setWinEvent((prev) => (prev ? { ...prev, claimStatus: 'failed' } : null))
      })
      .finally(() => {
        claimingRef.current = false
      })
  }, [winEvent, claim])

  // Auto-dismiss after claim resolves
  useEffect(() => {
    if (!winEvent || winEvent.claimStatus === 'pending' || winEvent.claimStatus === 'claiming')
      return

    const timer = setTimeout(() => setWinEvent(null), 2500)
    return () => clearTimeout(timer)
  }, [winEvent?.claimStatus])

  useEffect(() => {
    return subscribe(handleMessage)
  }, [subscribe, handleMessage])

  const statusText =
    winEvent?.claimStatus === 'claiming'
      ? 'Claiming...'
      : winEvent?.claimStatus === 'claimed'
        ? 'Claimed!'
        : winEvent?.claimStatus === 'failed'
          ? 'Claim later in Profile'
          : 'You won!'

  return (
    <AnimatePresence>
      {winEvent?.userWon && winEvent.winAmount > 0 && (
        <motion.div
          key={winEvent.roundId}
          initial={{ opacity: 0, y: 20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -40, scale: 1.1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-3xl font-bold font-mono text-base-cyan drop-shadow-[0_0_20px_rgba(60,138,255,0.6)]">
              +{winEvent.winAmount.toFixed(2)} USDC
            </span>
            <span className="text-sm text-base-light/80">{statusText}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

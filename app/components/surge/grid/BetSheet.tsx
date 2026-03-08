
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../../../lib/surge/utils'
import { usePlaceBet } from '../../../hooks/surge/usePlaceBet'
import { BET_AMOUNTS, MIN_BET, MAX_BET } from '../../../lib/surge/constants'
import type { SelectedCell } from '../../../lib/surge/types'

interface BetSheetProps {
  cell: SelectedCell | null
  onClose: () => void
  selectedAmount: number
  onAmountChange: (amount: number) => void
}

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function BetSheet({
  cell,
  onClose,
  selectedAmount,
  onAmountChange,
}: BetSheetProps) {
  const { placeBet, isPending, isConfirming } = usePlaceBet()
  const [customAmount, setCustomAmount] = useState('')

  const isCustom = !BET_AMOUNTS.includes(selectedAmount as typeof BET_AMOUNTS[number])
  const potentialPayout = cell ? selectedAmount * cell.currentMultiplier : 0
  const canBet = cell?.columnStatus === 'open' && selectedAmount >= MIN_BET && selectedAmount <= MAX_BET

  const handlePlaceBet = async () => {
    if (!cell || !canBet) return
    onClose()
    await placeBet(cell.roundId, cell.bucketIndex, selectedAmount)
  }

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value)
    const num = parseFloat(value)
    if (!isNaN(num) && num > 0) {
      onAmountChange(num)
    }
  }

  return (
    <Sheet open={!!cell} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="border-border bg-card rounded-t-2xl max-h-[45vh]"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base-light text-base">
            Place Your Bet
          </SheetTitle>
          {cell && (
            <SheetDescription className="text-text-secondary text-xs font-mono">
              ${cell.priceRange.low.toFixed(4)} — ${cell.priceRange.high.toFixed(4)} at{' '}
              {formatTime(cell.endTime)}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {/* Current multiplier */}
          {cell && cell.currentMultiplier > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Current Multiplier</span>
              <span className="font-mono text-lg font-bold text-base-cyan">
                {cell.currentMultiplier.toFixed(2)}X
              </span>
            </div>
          )}

          {/* Preset amounts */}
          <div className="flex gap-2">
            {BET_AMOUNTS.map((amt) => (
              <Button
                key={amt}
                variant={selectedAmount === amt && !isCustom ? 'default' : 'outline'}
                onClick={() => {
                  onAmountChange(amt)
                  setCustomAmount('')
                }}
                className={cn(
                  'flex-1 font-mono text-sm h-10',
                  selectedAmount === amt &&
                    !isCustom &&
                    'bg-base-blue hover:bg-base-blue/80 shadow-[0_0_12px_rgba(0,0,255,0.3)]'
                )}
              >
                {amt}
              </Button>
            ))}
          </div>

          {/* Custom amount */}
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Custom amount"
              type="number"
              step="0.01"
              min={MIN_BET}
              max={MAX_BET}
              value={customAmount}
              onChange={(e) => handleCustomAmountChange(e.target.value)}
              className="font-mono text-sm bg-secondary border-border"
            />
            <span className="text-xs text-text-muted shrink-0">USDC</span>
          </div>

          {/* Potential payout */}
          {cell && cell.currentMultiplier > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2">
              <span className="text-xs text-text-muted">Potential Win</span>
              <span className="font-mono text-base font-bold text-base-cyan">
                {potentialPayout.toFixed(2)} USDC
              </span>
            </div>
          )}

          {/* Place bet button */}
          <Button
            onClick={handlePlaceBet}
            disabled={!canBet || isPending || isConfirming}
            className="w-full h-12 bg-base-blue hover:bg-base-blue/80 text-white font-bold text-base shadow-[0_0_20px_rgba(0,0,255,0.3)] disabled:opacity-50"
          >
            {isPending || isConfirming
              ? 'Placing Bet...'
              : cell?.columnStatus === 'locked'
                ? 'Round Locked'
                : `Bet ${selectedAmount} USDC`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

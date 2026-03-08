
import { useCallback, useState } from 'react'
import { useSendTransaction } from '@privy-io/react-auth'
import { encodeFunctionData } from 'viem'
import { toast } from 'sonner'
import { TAPGRID_ABI, TAPGRID_ADDRESS } from '../../lib/surge/contracts'

export function useClaimWinnings() {
  const { sendTransaction } = useSendTransaction()
  const [isPending, setIsPending] = useState(false)

  const claim = useCallback(
    async (roundId: number) => {
      setIsPending(true)
      try {
        const data = encodeFunctionData({
          abi: TAPGRID_ABI,
          functionName: 'claimWinnings',
          args: [BigInt(roundId)],
        })

        const receipt = await sendTransaction(
          { to: TAPGRID_ADDRESS, data, gasLimit: 300_000n },
          { uiOptions: { showWalletUIs: false } },
        )

        if (receipt?.hash) {
          toast.success('Winnings claimed!')
        }
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('User rejected') || msg.includes('denied')) {
          toast.error('Claim cancelled')
        } else if (msg.includes('Already claimed')) {
          // Silent — already claimed is fine
        } else {
          toast.error('Claim failed — try from Profile')
          console.error('[claim]', msg.slice(0, 300))
        }
      } finally {
        setIsPending(false)
      }
    },
    [sendTransaction],
  )

  const batchClaim = useCallback(
    async (roundIds: number[]) => {
      if (roundIds.length === 0) return
      setIsPending(true)
      try {
        const data = encodeFunctionData({
          abi: TAPGRID_ABI,
          functionName: 'batchClaimWinnings',
          args: [roundIds.map((id) => BigInt(id))],
        })

        const receipt = await sendTransaction(
          { to: TAPGRID_ADDRESS, data, gasLimit: 500_000n },
          { uiOptions: { showWalletUIs: false } },
        )

        if (receipt?.hash) {
          toast.success(`Claimed ${roundIds.length} round${roundIds.length > 1 ? 's' : ''}!`)
        }
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('User rejected') || msg.includes('denied')) {
          toast.error('Claim cancelled')
        } else {
          toast.error('Batch claim failed — please try again')
          console.error('[batchClaim]', msg.slice(0, 300))
        }
      } finally {
        setIsPending(false)
      }
    },
    [sendTransaction],
  )

  return { claim, batchClaim, isPending }
}

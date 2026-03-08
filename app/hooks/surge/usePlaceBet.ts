
import { useCallback, useRef, useState } from 'react'
import { useSendTransaction, useWallets } from '@privy-io/react-auth'
import { encodeFunctionData, createPublicClient, http, maxUint256 } from 'viem'
import { toast } from 'sonner'
import { TAPGRID_ABI, ERC20_ABI, TAPGRID_ADDRESS, USDC_ADDRESS } from '../../lib/surge/contracts'
import { baseSepolia } from '../../lib/surge/chains'

interface UsePlaceBetReturn {
  placeBet: (roundId: number, bucketIndex: number, amountUSDC: number) => void
  isPending: boolean
  isConfirming: boolean
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'),
})

export function usePlaceBet() {
  const { sendTransaction } = useSendTransaction()
  const { wallets } = useWallets()
  const [isPending, setIsPending] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  // Ref always points to latest wallets to avoid stale closure
  const walletsRef = useRef(wallets)
  walletsRef.current = wallets

  const placeBet = useCallback(
    async (roundId: number, bucketIndex: number, amountUSDC: number) => {
      setIsPending(true)

      const toastId = toast.loading(`Betting ${amountUSDC} USDC...`)

      try {
        const currentWallets = walletsRef.current
        const wallet = currentWallets.find((w) => w.walletClientType === 'privy') ?? currentWallets[0]
        const userAddress = wallet?.address as `0x${string}` | undefined

        if (!userAddress) {
          toast.error('Wallet not connected — please reconnect', { id: toastId })
          return
        }

        const amountRaw = BigInt(Math.round(amountUSDC * 1e6))

        // Check USDC allowance
        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [userAddress, TAPGRID_ADDRESS],
        })

        // Approve max if allowance is insufficient
        if (allowance < amountRaw) {
          toast.loading('Approving USDC...', { id: toastId })

          const approveData = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [TAPGRID_ADDRESS, maxUint256],
          })

          await sendTransaction(
            {
              to: USDC_ADDRESS,
              data: approveData,
              gasLimit: 100_000n,
            },
            {
              uiOptions: { showWalletUIs: false },
            }
          )

          toast.loading(`Betting ${amountUSDC} USDC...`, { id: toastId })
        }

        // Place the bet
        const data = encodeFunctionData({
          abi: TAPGRID_ABI,
          functionName: 'placeBet',
          args: [BigInt(roundId), bucketIndex, amountRaw],
        })

        setIsConfirming(true)
        const receipt = await sendTransaction(
          {
            to: TAPGRID_ADDRESS,
            data,
            gasLimit: 300_000n,
          },
          {
            uiOptions: { showWalletUIs: false },
          }
        )

        if (receipt?.hash) {
          toast.success('Bet placed!', { id: toastId })
        }
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('User rejected') || msg.includes('denied')) {
          toast.error('Transaction cancelled', { id: toastId })
        } else if (msg.includes('locked')) {
          toast.error('Round is locked — try a future column', { id: toastId })
        } else if (msg.includes('min bet') || msg.includes('Below')) {
          toast.error('Below minimum bet (1 USDC)', { id: toastId })
        } else if (msg.includes('max bet') || msg.includes('Exceeds')) {
          toast.error('Exceeds max bet per cell (100 USDC)', { id: toastId })
        } else if (msg.includes('insufficient') || msg.includes('transfer amount exceeds')) {
          toast.error('Insufficient USDC balance', { id: toastId })
        } else {
          toast.error('Bet failed — please try again', { id: toastId })
          console.error('[placeBet]', msg.slice(0, 300))
        }
      } finally {
        setIsPending(false)
        setIsConfirming(false)
      }
    },
    [sendTransaction]
  )

  return {
    placeBet,
    isPending,
    isConfirming,
  } satisfies UsePlaceBetReturn
}

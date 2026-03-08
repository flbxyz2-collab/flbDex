
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useReadContract } from 'wagmi'
import { baseSepolia } from '../../lib/surge/chains'
import { ERC20_ABI, USDC_ADDRESS } from '../../lib/surge/contracts'
import { motion, AnimatePresence } from 'framer-motion'

export default function BalanceDisplay() {
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()

  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0]
  const address = wallet?.address as `0x${string}` | undefined

  const { data: balance, isLoading } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: baseSepolia.id,
    query: {
      enabled: !!address && authenticated,
      refetchInterval: 10_000,
    },
  })

  if (!authenticated) return null

  if (isLoading || balance === undefined) {
    return (
      <span className="font-mono text-sm text-text-muted">
        -- USDC
      </span>
    )
  }

  const formatted = (Number(balance) / 1e6).toFixed(2)

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={formatted}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.2 }}
        className="font-mono text-sm text-base-light"
      >
        {formatted} USDC
      </motion.span>
    </AnimatePresence>
  )
}

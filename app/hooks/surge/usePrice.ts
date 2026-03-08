
import { useMemo } from 'react'
import { useWebSocket } from './useWebSocket'
import type { PricePoint } from '../../lib/surge/types'

const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 5,
})

interface UsePriceReturn {
  price: number
  formatted: string
  timestamp: number
  priceHistory: PricePoint[]
}

export function usePrice(): UsePriceReturn {
  const { price, priceTimestamp, getPriceHistory } = useWebSocket()

  const formatted = useMemo(() => {
    if (price === 0) return '$0.0000'
    return priceFormatter.format(price)
  }, [price])

  return {
    price,
    formatted,
    timestamp: priceTimestamp,
    priceHistory: getPriceHistory(),
  }
}

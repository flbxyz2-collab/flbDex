import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUSDC(amount: bigint, decimals = 2): string {
  return (Number(amount) / 1e6).toFixed(decimals)
}

import { TAPGRID_ABI, ERC20_ABI } from './abi/TapGrid'

export { TAPGRID_ABI, ERC20_ABI }

export const TAPGRID_ADDRESS = (import.meta.env.VITE_TAPGRID_ADDRESS ?? '') as `0x${string}`
export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`

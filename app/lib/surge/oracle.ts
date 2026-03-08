export type OracleProvider = 'stork' | 'pyth' | 'mock'

export const ORACLE_PROVIDER: OracleProvider =
  (import.meta.env.VITE_ORACLE_PROVIDER as OracleProvider) ?? 'stork'

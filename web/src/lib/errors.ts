import { describeProgramError } from '@wallet/program-client'

/** Raised when a transaction was confirmed but failed on-chain. `err` is the RPC's error object. */
export class TransactionFailedError extends Error {
  readonly err: unknown
  constructor(err: unknown) {
    super('Transaction failed on-chain')
    this.name = 'TransactionFailedError'
    this.err = err
  }
}

const SLIPPAGE_CODE = 6003

/** Pull the custom program error code out of an RPC error object or message, if there is one. */
function customCode(e: unknown): number | undefined {
  if (e instanceof TransactionFailedError) {
    const ie = (e.err as { InstructionError?: [number, { Custom?: number }] } | null)?.InstructionError
    return ie?.[1]?.Custom
  }
  const msg = e instanceof Error ? e.message : String(e)
  const dec = /custom program error: #(\d+)/i.exec(msg)
  if (dec) return Number(dec[1])
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(msg)
  if (hex) return parseInt(hex[1], 16)
  return undefined
}

/** Turn any error from sending a transaction into something a person can act on. */
export function friendlyError(e: unknown): string {
  const code = customCode(e)
  if (code === SLIPPAGE_CODE) {
    return 'The price moved more than your slippage tolerance, so nothing was swapped. Try again, or allow more slippage.'
  }
  if (code !== undefined && code >= 6000) {
    const known = describeProgramError(code)
    if (known) return `${known.message}.`
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (code === 1 || /insufficient (funds|lamports)|0x1\b/i.test(msg)) return 'Insufficient funds for this transaction.'
  if (/blockhash/i.test(msg)) return 'The network was busy. Please try again.'
  if (/user rejected|declined/i.test(msg)) return 'The transaction was cancelled.'
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg
}

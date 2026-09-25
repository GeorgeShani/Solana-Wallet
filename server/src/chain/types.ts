import type { Address } from '@solana/addresses'
import type { Transaction } from '@solana/transactions'

/** The few chain operations the routes need (faked in tests). */
export interface Chain {
  /** Broadcast a signed base64 wire transaction (with preflight simulation). Returns its signature. */
  sendTransaction(base64Wire: string): Promise<string>
  getBalance(address: Address): Promise<bigint>
  /** Resolve once confirmed; throw if it failed on-chain or never landed. */
  confirm(signature: string): Promise<void>
}

/** Pays transaction fees on behalf of users (claim links). */
export interface Relayer {
  address: Address
  /** Adds the fee payer's signature to a transaction that the policy has already approved. */
  sign(transaction: Transaction): Promise<Transaction>
}

export interface TokenDrop {
  mint: Address
  amount: bigint
}

/** Mints the devnet test tokens (the server wallet is their mint authority). */
export interface Minter {
  address: Address
  /** Creates the recipient's token accounts if needed and mints. Returns the confirmed signature. */
  mintTokens(recipient: Address, drops: TokenDrop[]): Promise<string>
}

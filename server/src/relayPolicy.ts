import type { Address } from '@solana/addresses'
import { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages'
import { getTransactionDecoder, type Transaction } from '@solana/transactions'
import { ASSOCIATED_TOKEN_PROGRAM, instructionDiscriminator, PROGRAM_ADDRESS } from '@wallet/program-client'

/**
 * What the relayer is willing to pay for.
 *
 * The relayer signs as fee payer for whatever it is handed, so an open relay would be drained
 * in minutes. It therefore accepts one narrow shape only: a claim of a link (our program's
 * `claim_sol_link` or `claim_token_link`), optionally preceded by creating the recipient's token
 * account. The relayer's address may appear only as the fee payer (and as the account-creation
 * payer); it can never be a source of funds, an authority, or a writable account of anything else.
 */

const CLAIM_INSTRUCTIONS = ['claim_sol_link', 'claim_token_link'] as const
const MAX_INSTRUCTIONS = 2
/** Largest legal transaction on Solana. */
export const MAX_TRANSACTION_BYTES = 1232

export type PolicyResult =
  | { ok: true; transaction: Transaction; claim: (typeof CLAIM_INSTRUCTIONS)[number] }
  | { ok: false; reason: string }

const fail = (reason: string): PolicyResult => ({ ok: false, reason })

const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((v, i) => v === b[i])

export function checkRelayTransaction(wire: Uint8Array, relayer: Address): PolicyResult {
  if (wire.length === 0 || wire.length > MAX_TRANSACTION_BYTES) return fail('Transaction has an invalid size')

  let transaction: Transaction
  let message: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>
  try {
    transaction = getTransactionDecoder().decode(wire)
    message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
  } catch {
    return fail('Malformed transaction')
  }

  const accounts = message.staticAccounts as Address[]
  if (accounts[0] !== relayer) return fail('The fee payer must be the relayer')

  // Everyone other than the relayer must already have signed: the relayer only adds the fee.
  const signerCount = message.header.numSignerAccounts
  for (const signer of accounts.slice(1, signerCount)) {
    if (!transaction.signatures[signer]) return fail(`Missing signature from ${signer}`)
  }

  if (message.instructions.length === 0 || message.instructions.length > MAX_INSTRUCTIONS) {
    return fail('Unexpected number of instructions')
  }

  let claim: (typeof CLAIM_INSTRUCTIONS)[number] | null = null
  let accountCreations = 0
  for (const ix of message.instructions) {
    const program = accounts[ix.programAddressIndex]
    const ixAccounts = (ix.accountIndices ?? []).map((i) => accounts[i])
    // An index past the static accounts would point into an address lookup table, where the
    // relayer's address could hide from the checks below. We don't use lookup tables: refuse them.
    if (!program || ixAccounts.some((a) => !a)) return fail('Address lookup tables are not supported')
    const data = ix.data ?? new Uint8Array()

    if (program === PROGRAM_ADDRESS) {
      const name = CLAIM_INSTRUCTIONS.find((n) => sameBytes(data.subarray(0, 8), instructionDiscriminator(n)))
      if (!name) return fail('Only claim instructions can be relayed')
      if (claim) return fail('Only one claim per transaction')
      if (ixAccounts.includes(relayer)) return fail('The relayer cannot be an account of a claim')
      claim = name
    } else if (program === ASSOCIATED_TOKEN_PROGRAM) {
      // CreateIdempotent (discriminator 1): accounts are [payer, ata, owner, mint, system, token]
      if (data.length !== 1 || data[0] !== 1) return fail('Only idempotent token-account creation is allowed')
      if (ixAccounts.slice(1).includes(relayer)) return fail('The relayer may only be the account-creation payer')
      if (++accountCreations > 1) return fail('Only one token account can be created')
    } else {
      return fail(`Program ${program} is not allowed`)
    }
  }
  if (!claim) return fail('The transaction must claim a link')

  return { ok: true, transaction, claim }
}

import { describe, expect, test } from 'bun:test'
import { address } from '@solana/addresses'
import {
  createAssociatedTokenAccountIdempotent,
  instructionDiscriminator,
  PROGRAM_ADDRESS,
  swapInstruction,
  systemTransfer,
  derivePoolAddresses,
} from '@wallet/program-client'
import { checkRelayTransaction, MAX_TRANSACTION_BYTES } from './relay.policy'
import { buildTx, claimFixtures, newSigner, tokenClaimFixtures } from '../../shared/testUtils'

const MINT = address('19wY9kjM8ijyUhjhT2vRBkcpBsXLG8HRMvrNXXQEkdB')
const reasonOf = (r: ReturnType<typeof checkRelayTransaction>) => (r.ok ? 'ok' : r.reason)

describe('relay policy: what the relayer agrees to pay for', () => {
  test('accepts a SOL link claim signed by the claim key', async () => {
    const relayer = await newSigner()
    const f = await claimFixtures()
    const { bytes } = await buildTx({ feePayer: relayer.address, instructions: [f.sol], signers: [f.claimKey] })
    const verdict = checkRelayTransaction(bytes, relayer.address)
    expect(verdict.ok && verdict.claim).toBe('claim_sol_link')
  })

  test('accepts a token link claim that also creates the recipient token account', async () => {
    const relayer = await newSigner()
    const f = await tokenClaimFixtures(MINT, relayer.address)
    const { bytes } = await buildTx({ feePayer: relayer.address, instructions: [f.createAta, f.tokenClaim], signers: [f.claimKey] })
    const verdict = checkRelayTransaction(bytes, relayer.address)
    expect(verdict.ok && verdict.claim).toBe('claim_token_link')
  })

  test('rejects a transaction whose fee payer is not the relayer', async () => {
    const [relayer, other] = await Promise.all([newSigner(), newSigner()])
    const f = await claimFixtures()
    const { bytes } = await buildTx({ feePayer: other.address, instructions: [f.sol], signers: [f.claimKey, other] })
    expect(reasonOf(checkRelayTransaction(bytes, relayer.address))).toBe('The fee payer must be the relayer')
  })

  test('rejects a claim that is missing the claim key signature', async () => {
    const relayer = await newSigner()
    const f = await claimFixtures()
    const { bytes } = await buildTx({ feePayer: relayer.address, instructions: [f.sol], signers: [] })
    expect(reasonOf(checkRelayTransaction(bytes, relayer.address))).toContain('Missing signature')
  })

  test('rejects draining the relayer with a transfer', async () => {
    const [relayer, thief] = await Promise.all([newSigner(), newSigner()])
    const f = await claimFixtures()
    const drain = systemTransfer({ from: relayer.address, to: thief.address, lamports: 1_000_000_000n })
    // even bundled with a legitimate claim
    for (const instructions of [[drain], [f.sol, drain]]) {
      const signers = instructions.includes(f.sol) ? [f.claimKey] : []
      const { bytes } = await buildTx({ feePayer: relayer.address, instructions, signers })
      expect(reasonOf(checkRelayTransaction(bytes, relayer.address))).toContain('is not allowed')
    }
  })

  test('rejects using the relayer as an account inside a claim', async () => {
    const relayer = await newSigner()
    const f = await claimFixtures()
    // recipient == relayer would route the payout into the relayer; as any account it is refused
    const { claimSolLinkInstruction } = await import('@wallet/program-client')
    const ix = claimSolLinkInstruction({ claimKey: f.claimKey.address, claim: f.claim, sender: f.sender.address, recipient: relayer.address })
    const { bytes } = await buildTx({ feePayer: relayer.address, instructions: [ix], signers: [f.claimKey] })
    expect(reasonOf(checkRelayTransaction(bytes, relayer.address))).toBe('The relayer cannot be an account of a claim')
  })

  test('rejects other instructions of our own program (swaps, link creation, refunds)', async () => {
    const relayer = await newSigner()
    const pool = await derivePoolAddresses(MINT, address('So11111111111111111111111111111111111111112'))
    const swap = swapInstruction({
      user: relayer.address,
      pool,
      userA: relayer.address,
      userB: relayer.address,
      amountIn: 1n,
      minAmountOut: 0n,
      aToB: true,
    })
    const { bytes } = await buildTx({ feePayer: relayer.address, instructions: [swap] })
    expect(reasonOf(checkRelayTransaction(bytes, relayer.address))).toBe('Only claim instructions can be relayed')

    for (const name of ['create_sol_link', 'refund_sol_link', 'create_token_link', 'refund_token_link']) {
      const ix = { programAddress: PROGRAM_ADDRESS, accounts: [], data: instructionDiscriminator(name) }
      const tx = await buildTx({ feePayer: relayer.address, instructions: [ix] })
      expect(reasonOf(checkRelayTransaction(tx.bytes, relayer.address))).toBe('Only claim instructions can be relayed')
    }
  })

  test('rejects two claims in one transaction, and a transaction with no claim', async () => {
    const relayer = await newSigner()
    const f = await claimFixtures()
    const f2 = await claimFixtures()
    const two = await buildTx({ feePayer: relayer.address, instructions: [f.sol, f2.sol], signers: [f.claimKey, f2.claimKey] })
    expect(reasonOf(checkRelayTransaction(two.bytes, relayer.address))).toBe('Only one claim per transaction')

    const ata = createAssociatedTokenAccountIdempotent({ payer: relayer.address, ata: f.claim, owner: f.recipient.address, mint: MINT })
    const none = await buildTx({ feePayer: relayer.address, instructions: [ata] })
    expect(reasonOf(checkRelayTransaction(none.bytes, relayer.address))).toBe('The transaction must claim a link')
  })

  test('limits token-account creation: idempotent only, relayer only as payer, at most one', async () => {
    const relayer = await newSigner()
    const f = await tokenClaimFixtures(MINT, relayer.address)
    const run = async (instructions: Parameters<typeof buildTx>[0]['instructions']) => {
      const { bytes } = await buildTx({ feePayer: relayer.address, instructions, signers: [f.claimKey] })
      return reasonOf(checkRelayTransaction(bytes, relayer.address))
    }
    // relayer as the *owner* of the new account
    const asOwner = createAssociatedTokenAccountIdempotent({ payer: relayer.address, ata: f.recipientToken, owner: relayer.address, mint: MINT })
    expect(await run([asOwner, f.tokenClaim])).toBe('The relayer may only be the account-creation payer')
    // the non-idempotent "Create" variant
    expect(await run([{ ...f.createAta, data: Uint8Array.of(0) }, f.tokenClaim])).toBe('Only idempotent token-account creation is allowed')
    // two creations (and thus three instructions)
    expect(await run([f.createAta, f.createAta, f.tokenClaim])).toBe('Unexpected number of instructions')
  })

  test('rejects garbage, empty and oversized input', async () => {
    const relayer = await newSigner()
    expect(reasonOf(checkRelayTransaction(new Uint8Array(0), relayer.address))).toBe('Transaction has an invalid size')
    expect(reasonOf(checkRelayTransaction(new Uint8Array(MAX_TRANSACTION_BYTES + 1), relayer.address))).toBe('Transaction has an invalid size')
    expect(reasonOf(checkRelayTransaction(Uint8Array.from({ length: 200 }, (_, i) => (i * 7) % 256), relayer.address))).toBe('Malformed transaction')
  })
})

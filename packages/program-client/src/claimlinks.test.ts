import { describe, expect, test } from 'bun:test'
import { address, getAddressEncoder } from '@solana/addresses'
import { AccountRole } from '@solana/instructions'
import {
  CLAIM_LINK_DISCRIMINATOR,
  CLAIM_LINK_SIZE,
  claimSolLinkInstruction,
  claimTokenLinkInstruction,
  createSolLinkInstruction,
  createTokenLinkInstruction,
  decodeClaimLink,
  deriveClaimAddresses,
  findAssociatedTokenAddress,
  i64,
  instructionDiscriminator,
  refundSolLinkInstruction,
  refundTokenLinkInstruction,
  u64,
} from './index'

const SENDER = address('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')
const CLAIM_KEY = address('9LocV1FP6dDVjsmkncsW54oWg9MF3NZAjMgjPkcqrNb7')
const RECIPIENT = address('141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i')
const MINT = address('19wY9kjM8ijyUhjhT2vRBkcpBsXLG8HRMvrNXXQEkdB')

describe('claim link client', () => {
  test('discriminators come from the IDL', () => {
    for (const name of ['create_sol_link', 'claim_sol_link', 'refund_sol_link', 'create_token_link', 'claim_token_link', 'refund_token_link']) {
      expect(instructionDiscriminator(name)).toHaveLength(8)
    }
    // all distinct
    const all = ['create_sol_link', 'claim_sol_link', 'refund_sol_link', 'create_token_link', 'claim_token_link', 'refund_token_link', 'swap'].map(
      (n) => Array.from(instructionDiscriminator(n)).join(','),
    )
    expect(new Set(all).size).toBe(all.length)
  })

  test('i64 encodes negatives and rejects overflow', () => {
    expect(Array.from(i64(-1n))).toEqual(new Array(8).fill(255))
    expect(Array.from(i64(1_000_000n))).toEqual([64, 66, 15, 0, 0, 0, 0, 0])
    expect(() => i64(2n ** 63n)).toThrow()
  })

  test('deriveClaimAddresses: SOL links have no vault, token links get the escrow ATA', async () => {
    const sol = await deriveClaimAddresses(CLAIM_KEY)
    expect(sol.vault).toBeUndefined()
    const tok = await deriveClaimAddresses(CLAIM_KEY, MINT)
    expect(tok.claim).toBe(sol.claim)
    expect(tok.vault).toBe(await findAssociatedTokenAddress(tok.claim, MINT))
  })

  test('create_sol_link: accounts, roles and data', async () => {
    const { claim } = await deriveClaimAddresses(CLAIM_KEY)
    const ix = createSolLinkInstruction({ sender: SENDER, claimKey: CLAIM_KEY, claim, amount: 500_000_000n, expiry: 1_700_000_000n })
    expect(ix.accounts!.map((a) => a.address)).toEqual([SENDER, CLAIM_KEY, claim, '11111111111111111111111111111111'])
    expect(ix.accounts![0].role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(ix.accounts![1].role).toBe(AccountRole.READONLY) // the claim key's address only; it does not sign
    expect(ix.accounts![2].role).toBe(AccountRole.WRITABLE)
    expect(Array.from(ix.data!)).toEqual([
      ...instructionDiscriminator('create_sol_link'),
      ...u64(500_000_000n),
      ...i64(1_700_000_000n),
    ])
  })

  test('claim_sol_link: the claim key signs, the recipient is just an address', async () => {
    const { claim } = await deriveClaimAddresses(CLAIM_KEY)
    const ix = claimSolLinkInstruction({ claimKey: CLAIM_KEY, claim, sender: SENDER, recipient: RECIPIENT })
    expect(ix.accounts!.map((a) => a.address)).toEqual([CLAIM_KEY, claim, SENDER, RECIPIENT])
    expect(ix.accounts![0].role).toBe(AccountRole.READONLY_SIGNER)
    expect(ix.accounts![3].role).toBe(AccountRole.WRITABLE)
    expect(Array.from(ix.data!)).toEqual(Array.from(instructionDiscriminator('claim_sol_link'))) // no arguments
  })

  test('refund_sol_link: only the sender signs', async () => {
    const { claim } = await deriveClaimAddresses(CLAIM_KEY)
    const ix = refundSolLinkInstruction({ sender: SENDER, claim })
    expect(ix.accounts!.map((a) => a.address)).toEqual([SENDER, claim])
    expect(ix.accounts![0].role).toBe(AccountRole.WRITABLE_SIGNER)
  })

  test('token link instructions', async () => {
    const { claim, vault } = await deriveClaimAddresses(CLAIM_KEY, MINT)
    const senderToken = await findAssociatedTokenAddress(SENDER, MINT)
    const create = createTokenLinkInstruction({ sender: SENDER, claimKey: CLAIM_KEY, mint: MINT, claim, vault: vault!, senderToken, amount: 1n, expiry: 2n })
    expect(create.accounts).toHaveLength(9)
    expect(create.accounts![5].address).toBe(senderToken)

    const recipientToken = await findAssociatedTokenAddress(RECIPIENT, MINT)
    const claimIx = claimTokenLinkInstruction({ claimKey: CLAIM_KEY, claim, sender: SENDER, mint: MINT, vault: vault!, recipientToken })
    expect(claimIx.accounts!.map((a) => a.address)).toEqual([
      CLAIM_KEY, claim, SENDER, MINT, vault, recipientToken, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ])
    expect(claimIx.accounts![0].role).toBe(AccountRole.READONLY_SIGNER)

    const refund = refundTokenLinkInstruction({ sender: SENDER, claim, mint: MINT, vault: vault!, senderToken })
    expect(refund.accounts).toHaveLength(6)
  })

  test('decodeClaimLink reads a serialized ClaimLink (SOL and token)', () => {
    const enc = getAddressEncoder()
    const make = (mint: Uint8Array) => {
      const d = new Uint8Array(CLAIM_LINK_SIZE)
      d.set(CLAIM_LINK_DISCRIMINATOR, 0)
      d.set(enc.encode(SENDER), 8)
      d.set(enc.encode(CLAIM_KEY), 40)
      d.set(mint, 72)
      d.set(u64(123_456n), 104)
      d.set(i64(1_700_000_000n), 112)
      d[120] = 253
      return d
    }
    const sol = make(new Uint8Array(32))
    expect(decodeClaimLink(sol)).toEqual({
      sender: SENDER, claimKey: CLAIM_KEY, mint: null, amount: 123_456n, expiry: 1_700_000_000n, bump: 253,
    })
    const tok = make(Uint8Array.from(enc.encode(MINT)))
    expect(decodeClaimLink(tok).mint).toBe(MINT)

    expect(() => decodeClaimLink(new Uint8Array(CLAIM_LINK_SIZE))).toThrow() // wrong discriminator
    expect(() => decodeClaimLink(sol.subarray(0, 50))).toThrow() // truncated
  })
})

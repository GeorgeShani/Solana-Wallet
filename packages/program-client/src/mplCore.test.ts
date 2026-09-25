import { describe, expect, test } from 'bun:test'
import { address, getAddressEncoder } from '@solana/addresses'
import { AccountRole } from '@solana/instructions'
import {
  assetsOwnedByFilters,
  createAssetInstruction,
  decodeAsset,
  MPL_CORE_PROGRAM,
  NFT_NAME_MAX,
  transferAssetInstruction,
} from './index'

const OWNER = address('141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i')
const OTHER = address('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')
const ASSET = address('9LocV1FP6dDVjsmkncsW54oWg9MF3NZAjMgjPkcqrNb7')
const enc = getAddressEncoder()
const text = new TextEncoder()

/** An asset account as Core stores it. */
function assetAccount(o: { owner: string; authority?: { tag: number; key: string }; name: string; uri: string }) {
  const parts: number[][] = [[1], Array.from(enc.encode(address(o.owner)))]
  parts.push([o.authority?.tag ?? 0])
  if (o.authority && o.authority.tag !== 0) parts.push(Array.from(enc.encode(address(o.authority.key))))
  for (const s of [o.name, o.uri]) {
    const b = text.encode(s)
    parts.push(Array.from(new Uint8Array(new Uint32Array([b.length]).buffer)), Array.from(b))
  }
  parts.push([0]) // no sequence number
  return Uint8Array.from(parts.flat())
}

describe('Metaplex Core client', () => {
  test('create: the asset signs, the payer pays, optional accounts are "not provided"', () => {
    const ix = createAssetInstruction({
      asset: { address: ASSET, role: AccountRole.WRITABLE_SIGNER },
      payer: OWNER,
      name: 'Sunrise',
      uri: 'http://localhost:3000/nft/abc/metadata.json',
    })
    expect(ix.programAddress).toBe(MPL_CORE_PROGRAM)
    const acc = ix.accounts!
    expect(acc).toHaveLength(8)
    expect(acc[0]).toEqual({ address: ASSET, role: AccountRole.WRITABLE_SIGNER })
    expect(acc[3]).toEqual({ address: OWNER, role: AccountRole.WRITABLE_SIGNER })
    for (const i of [1, 2, 4, 5, 7]) expect(acc[i]).toEqual({ address: MPL_CORE_PROGRAM, role: AccountRole.READONLY })
    // instruction data: discriminator 0, state 0, "Sunrise", the uri, no plugins
    const d = ix.data!
    expect(Array.from(d.subarray(0, 2))).toEqual([0, 0])
    expect(new DataView(d.buffer, d.byteOffset).getUint32(2, true)).toBe(7)
    expect(new TextDecoder().decode(d.subarray(6, 13))).toBe('Sunrise')
    expect(d[d.length - 1]).toBe(0)
  })

  test('create can name a different owner', () => {
    const ix = createAssetInstruction({
      asset: { address: ASSET, role: AccountRole.WRITABLE_SIGNER },
      payer: OWNER,
      owner: OTHER,
      name: 'Gift',
      uri: 'http://x/y',
    })
    expect(ix.accounts![4]).toEqual({ address: OTHER, role: AccountRole.READONLY })
  })

  test('rejects empty, oversized and over-long inputs', () => {
    const base = { asset: { address: ASSET, role: AccountRole.WRITABLE_SIGNER }, payer: OWNER, name: 'ok', uri: 'http://x' }
    expect(() => createAssetInstruction({ ...base, name: '' })).toThrow()
    expect(() => createAssetInstruction({ ...base, name: 'x'.repeat(NFT_NAME_MAX + 1) })).toThrow()
    expect(() => createAssetInstruction({ ...base, name: 'é'.repeat(20) })).toThrow() // 40 bytes, not 20 characters
    expect(() => createAssetInstruction({ ...base, uri: 'x'.repeat(201) })).toThrow()
    expect(() => createAssetInstruction({ ...base, name: 'x'.repeat(NFT_NAME_MAX) })).not.toThrow()
  })

  test('transfer: the owner signs and pays, the new owner is read-only', () => {
    const ix = transferAssetInstruction({ asset: ASSET, payer: OWNER, newOwner: OTHER })
    const acc = ix.accounts!
    expect(acc[0]).toEqual({ address: ASSET, role: AccountRole.WRITABLE })
    expect(acc[2]).toEqual({ address: OWNER, role: AccountRole.WRITABLE_SIGNER })
    expect(acc[4]).toEqual({ address: OTHER, role: AccountRole.READONLY })
    expect(Array.from(ix.data!)).toEqual([14, 0])
    // only one signer, so nothing else has to sign
    expect(acc.filter((a) => a.role >= AccountRole.READONLY_SIGNER)).toHaveLength(1)
  })

  test('decodes an asset with an update authority, a collection, or none', () => {
    const uri = 'http://localhost:3000/nft/abc/metadata.json'
    const a = decodeAsset(assetAccount({ owner: OWNER, authority: { tag: 1, key: OTHER }, name: 'Sunrise', uri }))
    expect(a).toEqual({ owner: OWNER, updateAuthority: OTHER, name: 'Sunrise', uri })
    expect(decodeAsset(assetAccount({ owner: OWNER, authority: { tag: 2, key: OTHER }, name: 'A', uri: 'u' })).updateAuthority).toBe(OTHER)
    expect(decodeAsset(assetAccount({ owner: OWNER, name: 'B', uri: '' })).updateAuthority).toBeNull()
  })

  test('decodes non-ASCII names', () => {
    expect(decodeAsset(assetAccount({ owner: OWNER, name: 'Café ☕', uri: 'u' })).name).toBe('Café ☕')
  })

  test('refuses data that is not an asset or is cut short', () => {
    const good = assetAccount({ owner: OWNER, authority: { tag: 1, key: OTHER }, name: 'Sunrise', uri: 'http://x' })
    expect(() => decodeAsset(new Uint8Array())).toThrow()
    expect(() => decodeAsset(Uint8Array.of(2, ...good.subarray(1)))).toThrow() // a different account kind
    for (const cut of [10, 34, 60, 70, good.length - 12]) expect(() => decodeAsset(good.subarray(0, cut))).toThrow()
    const badTag = good.slice()
    badTag[33] = 9
    expect(() => decodeAsset(badTag)).toThrow()
    // a length prefix that promises more than there is
    const huge = good.slice()
    new DataView(huge.buffer).setUint32(66, 0xffffffff, true)
    expect(() => decodeAsset(huge)).toThrow()
  })

  test('the ownership filter is the asset key byte then the owner', () => {
    const [kind, owner] = assetsOwnedByFilters(OWNER)
    expect(kind.memcmp.bytes).toBe('2') // '1' is byte 0 in base58, so '2' is byte 1
    expect(kind.memcmp.offset).toBe(0n)
    expect(owner.memcmp).toEqual({ offset: 1n, bytes: OWNER, encoding: 'base58' })
  })
})

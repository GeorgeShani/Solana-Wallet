import { describe, expect, test } from 'bun:test'
import { address, getAddressEncoder } from '@solana/addresses'
import { AccountRole } from '@solana/instructions'
import {
  addLiquidityInstruction,
  closeTokenAccount,
  decodeMintSupply,
  decodePool,
  decodeTokenAmount,
  derivePoolAddresses,
  findAssociatedTokenAddress,
  initPoolInstruction,
  PROGRAM_ADDRESS,
  removeLiquidityInstruction,
  sortMints,
  swapInstruction,
  syncNative,
  systemTransfer,
  toTransactionMessage,
  u16,
  u64,
} from './index'

const WSOL = address('So11111111111111111111111111111111111111112')
const USDC = address('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const USER = address('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')

describe('program client', () => {
  test('program address matches the deployed program', () => {
    expect(PROGRAM_ADDRESS).toBe('6rAZLb32wv86p3uhqQQCZpDxn4BYiFBX7tqPvw7HpD27')
  })

  test('sortMints orders by raw bytes and is symmetric', () => {
    const [a, b] = sortMints(WSOL, USDC)
    expect(sortMints(USDC, WSOL)).toEqual([a, b])
    const enc = getAddressEncoder()
    expect(Buffer.compare(Buffer.from(enc.encode(a)), Buffer.from(enc.encode(b)))).toBe(-1)
    expect(() => sortMints(WSOL, WSOL)).toThrow()
  })

  test('derivePoolAddresses is deterministic and order-independent', async () => {
    const p1 = await derivePoolAddresses(WSOL, USDC)
    const p2 = await derivePoolAddresses(USDC, WSOL)
    expect(p1).toEqual(p2)
    expect(p1.pool).not.toBe(p1.lpMint)
    expect(p1.vaultA).toBe(await findAssociatedTokenAddress(p1.pool, p1.mintA))
  })

  test('swap instruction: IDL-driven account order/roles and borsh data layout', async () => {
    const pool = await derivePoolAddresses(WSOL, USDC)
    const ix = swapInstruction({
      user: USER,
      pool,
      userA: address('11111111111111111111111111111112'),
      userB: address('11111111111111111111111111111113'),
      amountIn: 10_000_000n,
      minAmountOut: 9_871_580n,
      aToB: true,
    })
    expect(ix.programAddress).toBe(PROGRAM_ADDRESS)
    expect(ix.accounts!.map((a) => a.address)).toEqual([
      USER, pool.pool, pool.mintA, pool.mintB, pool.vaultA, pool.vaultB,
      '11111111111111111111111111111112', '11111111111111111111111111111113',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ])
    expect(ix.accounts![0].role).toBe(AccountRole.WRITABLE_SIGNER) // user pays and signs
    expect(ix.accounts![1].role).toBe(AccountRole.READONLY) // pool
    expect(ix.accounts![4].role).toBe(AccountRole.WRITABLE) // vault_a
    // discriminator (from the IDL) + u64 + u64 + bool
    expect(Array.from(ix.data!)).toEqual([
      248, 198, 158, 145, 225, 117, 135, 200,
      ...u64(10_000_000n), ...u64(9_871_580n), 1,
    ])
  })

  test('init_pool / add / remove use the right discriminators and args', async () => {
    const pool = await derivePoolAddresses(WSOL, USDC)
    const init = initPoolInstruction({ payer: USER, pool, feeBps: 30 })
    expect(Array.from(init.data!)).toEqual([116, 233, 199, 204, 115, 159, 171, 36, ...u16(30)])
    expect(init.accounts).toHaveLength(10)

    const common = { user: USER, pool, userA: USER, userB: USER, userLp: USER }
    const add = addLiquidityInstruction({ ...common, amountADesired: 1n, amountBDesired: 2n, minLp: 3n })
    expect(Array.from(add.data!)).toEqual([181, 157, 89, 67, 143, 182, 52, 72, ...u64(1n), ...u64(2n), ...u64(3n)])
    expect(add.accounts).toHaveLength(12)

    const rem = removeLiquidityInstruction({ ...common, lpAmount: 4n, minAmountA: 5n, minAmountB: 6n })
    expect(Array.from(rem.data!)).toEqual([80, 85, 209, 72, 24, 206, 177, 108, ...u64(4n), ...u64(5n), ...u64(6n)])
  })

  test('u64 rejects out-of-range values', () => {
    expect(() => u64(-1n)).toThrow()
    expect(() => u64(2n ** 64n)).toThrow()
    expect(u64(2n ** 64n - 1n)).toEqual(new Uint8Array(8).fill(255))
  })

  test('token/system instruction encodings', () => {
    expect(Array.from(systemTransfer({ from: USER, to: WSOL, lamports: 5n }).data!)).toEqual([2, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0])
    expect(Array.from(syncNative(WSOL).data!)).toEqual([17])
    const close = closeTokenAccount({ account: WSOL, destination: USER, owner: USER })
    expect(Array.from(close.data!)).toEqual([9])
    expect(close.accounts![2].role).toBe(AccountRole.READONLY_SIGNER)
  })

  test('decodePool / decodeTokenAmount / decodeMintSupply', async () => {
    const pool = await derivePoolAddresses(WSOL, USDC)
    const enc = getAddressEncoder()
    const data = new Uint8Array(8 + 32 * 3 + 2 + 1)
    data.set([241, 154, 109, 4, 17, 177, 109, 188], 0) // Pool discriminator from the IDL
    data.set(enc.encode(pool.mintA), 8)
    data.set(enc.encode(pool.mintB), 40)
    data.set(enc.encode(pool.lpMint), 72)
    data.set(u16(30), 104)
    data[106] = 254
    expect(decodePool(data)).toEqual({ mintA: pool.mintA, mintB: pool.mintB, lpMint: pool.lpMint, feeBps: 30, bump: 254 })
    expect(() => decodePool(new Uint8Array(107))).toThrow()

    const tokenAcct = new Uint8Array(165)
    tokenAcct.set(u64(123_456_789n), 64)
    expect(decodeTokenAmount(tokenAcct)).toBe(123_456_789n)
    const mint = new Uint8Array(82)
    mint.set(u64(42n), 36)
    expect(decodeMintSupply(mint)).toBe(42n)
  })

  test('toTransactionMessage keeps instruction order', async () => {
    const pool = await derivePoolAddresses(WSOL, USDC)
    const a = syncNative(WSOL)
    const b = swapInstruction({ user: USER, pool, userA: USER, userB: USER, amountIn: 1n, minAmountOut: 0n, aToB: false })
    const msg = toTransactionMessage([a, b])
    expect(msg.version).toBe(0)
    expect(msg.instructions).toEqual([a, b])
  })
})

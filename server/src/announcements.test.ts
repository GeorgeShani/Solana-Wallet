import { describe, expect, test } from 'bun:test'
import { address } from '@solana/addresses'
import idl from '../../anchor/idl/wallet_program.json'
import { getAddressEncoder } from '@solana/addresses'
import { createIndexer, type ProgramSource, type SignatureInfo } from './announcements'
import { createApp } from './app'
import { createAnnouncementStore, createFaucetStore, openDatabase } from './db'
import { createRateLimiter } from './rateLimit'
import { newSigner } from './testUtils'

const enc = getAddressEncoder()
const DISC = idl.events.find((e) => e.name === 'StealthAnnouncement')!.discriminator
const bytes = (a: string) => Array.from(enc.encode(address(a)))

/** The log line the program emits for one announcement. */
const eventLine = (ephemeral: string, stealth: string, tag: number) =>
  'Program data: ' + btoa(String.fromCharCode(...DISC, ...bytes(ephemeral), ...bytes(stealth), tag))

const EPH = ['9LocV1FP6dDVjsmkncsW54oWg9MF3NZAjMgjPkcqrNb7', '5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4', '141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i']
const STEALTH = ['AemZnQTryaitgRVuvRzaBU7uUzg1hXtu2zkkARbUzRsV', '98SgBGbub4zqMrsvdPcEXAN4ovXWTUd3fCLHsS1oXmsG', '19wY9kjM8ijyUhjhT2vRBkcpBsXLG8HRMvrNXXQEkdB']

/** A fake program history. Index 0 is the oldest transaction. */
function fakeSource(txs: { sig: string; logs: string[]; err?: unknown }[]) {
  const calls = { list: 0, logs: [] as string[] }
  let failLogsFor: string | null = null
  const source: ProgramSource = {
    async listSignatures({ before, until, limit }) {
      calls.list++
      let all: SignatureInfo[] = txs.map((t, i) => ({ signature: t.sig, err: t.err ?? null, blockTime: 1000 + i })).reverse() // newest first
      if (until) all = all.slice(0, all.findIndex((s) => s.signature === until))
      if (before) all = all.slice(all.findIndex((s) => s.signature === before) + 1)
      return all.slice(0, limit)
    },
    async getLogs(sig) {
      calls.logs.push(sig)
      if (sig === failLogsFor) throw new Error('rate limited')
      return txs.find((t) => t.sig === sig)!.logs
    },
  }
  return { source, txs, calls, failOn: (s: string | null) => (failLogsFor = s) }
}

const setup = (txs: Parameters<typeof fakeSource>[0]) => {
  const store = createAnnouncementStore(openDatabase(':memory:'))
  const fake = fakeSource(txs)
  const indexer = createIndexer({ store, source: fake.source, minIntervalMs: 0 })
  return { store, fake, indexer }
}

describe('announcement indexer', () => {
  test('indexes announcements from program transactions, oldest first', async () => {
    const { store, indexer } = setup([
      { sig: 'tx1', logs: ['Program log: Instruction: Swap'] },
      { sig: 'tx2', logs: [eventLine(EPH[0], STEALTH[0], 10)] },
      { sig: 'tx3', logs: [eventLine(EPH[1], STEALTH[1], 20), eventLine(EPH[2], STEALTH[2], 30)] },
    ])
    await indexer.refresh()
    const rows = store.since(0, 100)
    expect(rows.map((r) => [r.signature, r.ephemeral, r.stealth, r.viewTag])).toEqual([
      ['tx2', EPH[0], STEALTH[0], 10],
      ['tx3', EPH[1], STEALTH[1], 20],
      ['tx3', EPH[2], STEALTH[2], 30],
    ])
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3])
    expect(rows[0].blockTime).toBe(1001)
    expect(store.getCursor()).toBe('tx3')
  })

  test('ignores failed transactions and non-announcement logs', async () => {
    const { store, indexer, fake } = setup([
      { sig: 'bad', logs: [eventLine(EPH[0], STEALTH[0], 1)], err: { InstructionError: [0, 'Custom'] } },
      { sig: 'noise', logs: ['Program data: AAAA', 'Program log: hi'] },
      { sig: 'good', logs: [eventLine(EPH[1], STEALTH[1], 2)] },
    ])
    await indexer.refresh()
    expect(store.since(0, 10).map((r) => r.signature)).toEqual(['good'])
    expect(fake.calls.logs).not.toContain('bad') // no point fetching a failed transaction
  })

  test('a second refresh only looks at new transactions', async () => {
    const { store, indexer, fake } = setup([{ sig: 'a', logs: [eventLine(EPH[0], STEALTH[0], 1)] }])
    await indexer.refresh()
    fake.txs.push({ sig: 'b', logs: [eventLine(EPH[1], STEALTH[1], 2)] })
    await indexer.refresh()
    await indexer.refresh() // nothing new: no work
    expect(fake.calls.logs).toEqual(['a', 'b'])
    expect(store.since(0, 10).map((r) => r.signature)).toEqual(['a', 'b'])
  })

  test('a failure part-way resumes where it stopped: nothing lost, nothing duplicated', async () => {
    const txs = ['t1', 't2', 't3', 't4', 't5'].map((sig, i) => ({ sig, logs: [eventLine(EPH[i % 3], STEALTH[i % 3], i)] }))
    const { store, indexer, fake } = setup(txs)
    fake.failOn('t4')
    await indexer.refresh()
    // the group containing t4 failed as a whole, so the cursor stayed behind it
    const firstPass = store.since(0, 10).map((r) => r.signature)
    expect(firstPass).toEqual(['t1', 't2', 't3'])
    expect(store.getCursor()).toBe('t3')

    fake.failOn(null)
    await indexer.refresh()
    expect(store.since(0, 10).map((r) => r.signature)).toEqual(['t1', 't2', 't3', 't4', 't5'])
  })

  test('walks through more than one page of history', async () => {
    const txs = Array.from({ length: 250 }, (_, i) => ({ sig: `s${i}`, logs: i % 50 === 0 ? [eventLine(EPH[0], STEALTH[0], i % 256)] : [] }))
    const { store, indexer } = setup(txs)
    await indexer.refresh()
    expect(store.since(0, 100).map((r) => r.signature)).toEqual(['s0', 's50', 's100', 's150', 's200'])
  })

  test('concurrent refreshes share one run; rapid ones are throttled', async () => {
    const store = createAnnouncementStore(openDatabase(':memory:'))
    const fake = fakeSource([{ sig: 'a', logs: [] }])
    let t = 0
    const indexer = createIndexer({ store, source: fake.source, minIntervalMs: 5_000, now: () => t })
    await Promise.all([indexer.refresh(), indexer.refresh(), indexer.refresh()])
    expect(fake.calls.list).toBe(1)
    t = 1_000
    await indexer.refresh()
    expect(fake.calls.list).toBe(1) // too soon
    t = 6_000
    await indexer.refresh()
    expect(fake.calls.list).toBe(2)
  })

  test('the store ignores rows it already has', () => {
    const store = createAnnouncementStore(openDatabase(':memory:'))
    const row = { signature: 'x', blockTime: 1, ephemeral: EPH[0], stealth: STEALTH[0], viewTag: 1 }
    store.insert([row])
    store.insert([row])
    expect(store.since(0, 10)).toHaveLength(1)
    expect(store.latestId()).toBe(1)
  })
})

describe('GET /announcements', () => {
  async function appWith(txs: Parameters<typeof fakeSource>[0]) {
    const db = openDatabase(':memory:')
    const store = createAnnouncementStore(db)
    const fake = fakeSource(txs)
    const indexer = createIndexer({ store, source: fake.source, minIntervalMs: 0 })
    const signer = await newSigner()
    const app = createApp({
      corsOrigins: ['http://localhost:5173'],
      chain: { sendTransaction: async () => 'x', getBalance: async () => 10n ** 10n, confirm: async () => {} },
      relayer: { address: signer.address, sign: async (t) => t },
      minter: { address: signer.address, mintTokens: async () => 'x' },
      faucetStore: createFaucetStore(db),
      prices: { get: async () => ({ solUsd: 1, updatedAt: 1, stale: false }) },
      announcements: { store, indexer },
      limiters: { announcements: createRateLimiter({ windowMs: 60_000, max: 1000 }) },
    })
    return app
  }
  const txs = [
    { sig: 'a', logs: [eventLine(EPH[0], STEALTH[0], 1)] },
    { sig: 'b', logs: [eventLine(EPH[1], STEALTH[1], 2)] },
    { sig: 'c', logs: [eventLine(EPH[2], STEALTH[2], 3)] },
  ]
  const get = (app: Awaited<ReturnType<typeof appWith>>, q = '') => app.request('/announcements' + q, { headers: { 'x-forwarded-for': '1.1.1.1' } })

  test('serves the feed and supports "everything after id N"', async () => {
    const app = await appWith(txs)
    const all = await (await get(app)).json()
    expect(all.items.map((i: { signature: string }) => i.signature)).toEqual(['a', 'b', 'c'])
    expect(all.latestId).toBe(3)
    expect(all.items[0]).toEqual({ id: 1, signature: 'a', blockTime: 1000, ephemeral: EPH[0], stealth: STEALTH[0], viewTag: 1 })

    const rest = await (await get(app, '?after=2')).json()
    expect(rest.items.map((i: { signature: string }) => i.signature)).toEqual(['c'])
    expect((await (await get(app, '?limit=2')).json()).items).toHaveLength(2)
  })

  test('rejects bad parameters', async () => {
    const app = await appWith(txs)
    for (const q of ['?after=-1', '?after=abc', '?limit=0', '?limit=1.5']) expect((await get(app, q)).status).toBe(400)
  })

  test('still serves what it has when the chain source fails', async () => {
    const app = await appWith(txs)
    await get(app) // index everything
    const db2 = openDatabase(':memory:')
    void db2
    // a source that always throws must not break the endpoint
    const broken = createIndexer({
      store: createAnnouncementStore(openDatabase(':memory:')),
      source: { listSignatures: async () => Promise.reject(new Error('rpc down')), getLogs: async () => null },
      minIntervalMs: 0,
    })
    await expect(broken.refresh()).resolves.toBeUndefined()
    expect((await get(app)).status).toBe(200)
  })
})

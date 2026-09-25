import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createFileNftStore, createMemoryNftStore, isNftId, type NftStore } from './nftStore'
import { createRateLimiter } from './rateLimit'
import { MAX_IMAGE_BYTES, nftRoutes, sniffImage } from './routes/nft'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1])
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function appWith(store: NftStore = createMemoryNftStore(), max = 1000) {
  const app = new Hono()
  app.route(
    '/nft',
    nftRoutes({
      store,
      publicUrl: 'http://localhost:3000/',
      limiter: createRateLimiter({ windowMs: 60_000, max }),
      clientIp: (c) => c.req.header('x-forwarded-for') ?? 'test',
    }),
  )
  return { app, store }
}

function upload(app: Hono, fields: { image?: Uint8Array | string; name?: string; description?: string; filename?: string }, ip = '1.1.1.1') {
  const form = new FormData()
  if (fields.image !== undefined) {
    form.set('image', new File([fields.image as BlobPart], fields.filename ?? 'pic.png', { type: 'image/png' }))
  }
  if (fields.name !== undefined) form.set('name', fields.name)
  if (fields.description !== undefined) form.set('description', fields.description)
  return app.request('/nft', { method: 'POST', body: form, headers: { 'x-forwarded-for': ip } })
}

describe('image sniffing', () => {
  test('recognises the four safe formats by their first bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png')
    expect(sniffImage(JPEG)).toBe('image/jpeg')
    expect(sniffImage(GIF)).toBe('image/gif')
    expect(sniffImage(WEBP)).toBe('image/webp')
  })
  test('rejects SVG, text, empty and truncated data', () => {
    expect(sniffImage(SVG)).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
    expect(sniffImage(PNG.subarray(0, 6))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('GIF89 but really just text'))).toBe('image/gif') // header only: the bytes decide
    expect(sniffImage(new TextEncoder().encode('hello world, not a picture'))).toBeNull()
  })
})

describe('POST /nft', () => {
  test('stores a picture and returns the links to put on-chain', async () => {
    const { app } = appWith()
    const res = await upload(app, { image: PNG, name: 'Sunrise', description: 'First light' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(isNftId(body.id)).toBe(true)
    expect(body.metadataUrl).toBe(`http://localhost:3000/nft/${body.id}/metadata.json`) // no double slash
    expect(body.imageUrl).toBe(`http://localhost:3000/nft/${body.id}/image`)
  })

  test('the metadata follows the Metaplex standard and points at the picture', async () => {
    const { app } = appWith()
    const { id } = await (await upload(app, { image: PNG, name: 'Sunrise', description: 'First light' })).json()
    const res = await app.request(`/nft/${id}/metadata.json`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: 'Sunrise',
      description: 'First light',
      image: `http://localhost:3000/nft/${id}/image`,
      properties: { category: 'image', files: [{ uri: `http://localhost:3000/nft/${id}/image`, type: 'image/png' }] },
    })
  })

  test('serves the exact bytes with safe headers', async () => {
    const { app } = appWith()
    const { id } = await (await upload(app, { image: JPEG, name: 'Pic' })).json()
    const res = await app.request(`/nft/${id}/image`)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG)
  })

  test('judges the picture by its bytes, not by the file name or claimed type', async () => {
    const { app } = appWith()
    const res = await upload(app, { image: SVG, name: 'Sneaky', filename: 'cat.png' })
    expect(res.status).toBe(415)
    const text = await upload(app, { image: 'just text pretending to be a picture', name: 'Text' })
    expect(text.status).toBe(415)
  })

  test('validates the form fields', async () => {
    const { app } = appWith()
    expect((await upload(app, { name: 'No picture' })).status).toBe(400)
    expect((await upload(app, { image: PNG })).status).toBe(400) // no name
    expect((await upload(app, { image: PNG, name: '   ' })).status).toBe(400)
    expect((await upload(app, { image: PNG, name: 'x'.repeat(33) })).status).toBe(400)
    expect((await upload(app, { image: PNG, name: 'é'.repeat(20) })).status).toBe(400) // 40 bytes
    expect((await upload(app, { image: PNG, name: 'ok', description: 'x'.repeat(501) })).status).toBe(400)
    expect((await upload(app, { image: PNG, name: 'x'.repeat(32), description: 'x'.repeat(500) })).status).toBe(201)
  })

  test('refuses pictures that are too large', async () => {
    const { app } = appWith()
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    big.set(PNG)
    expect((await upload(app, { image: big, name: 'Big' })).status).toBe(413)
    const ok = new Uint8Array(MAX_IMAGE_BYTES)
    ok.set(PNG)
    expect((await upload(app, { image: ok, name: 'Just fits' })).status).toBe(201)
  })

  test('is rate limited per caller', async () => {
    const { app } = appWith(undefined, 2)
    expect((await upload(app, { image: PNG, name: 'a' })).status).toBe(201)
    expect((await upload(app, { image: PNG, name: 'b' })).status).toBe(201)
    expect((await upload(app, { image: PNG, name: 'c' })).status).toBe(429)
    expect((await upload(app, { image: PNG, name: 'd' }, '2.2.2.2')).status).toBe(201) // someone else is fine
  })

  test('rejects a body that is not a form', async () => {
    const { app } = appWith()
    const res = await app.request('/nft', { method: 'POST', body: '{"name":"x"}', headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
  })
})

describe('GET /nft/:id', () => {
  test('unknown or malformed ids are a plain 404', async () => {
    const { app } = appWith()
    for (const id of ['0'.repeat(32), 'nope', '..%2F..%2Fetc%2Fpasswd', 'A'.repeat(32)]) {
      expect((await app.request(`/nft/${id}/image`)).status).toBe(404)
      expect((await app.request(`/nft/${id}/metadata.json`)).status).toBe(404)
    }
  })
})

describe('file store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nft-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('saves to disk and reads back', async () => {
    const store = createFileNftStore(dir)
    const id = await store.save({ image: PNG, mime: 'image/png', name: 'Disk', description: 'on disk' })
    expect(readdirSync(dir).sort()).toEqual([`${id}.img`, `${id}.json`])
    expect(await store.info(id)).toEqual({ name: 'Disk', description: 'on disk', mime: 'image/png' })
    expect(await store.image(id)).toEqual(PNG)
    expect(store.count()).toBe(1)
    // a fresh store over the same folder still sees it (survives a restart)
    expect(createFileNftStore(dir).count()).toBe(1)
  })

  test('ids that are not plain hex never touch the disk', async () => {
    const store = createFileNftStore(dir)
    expect(await store.info('../secret')).toBeNull()
    expect(await store.image('../../etc/passwd')).toBeNull()
    expect(await store.info('f'.repeat(32))).toBeNull()
  })
})

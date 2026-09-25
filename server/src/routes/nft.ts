import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { isNftId, type NftStore } from '../nftStore'
import type { RateLimiter } from '../rateLimit'

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_NAME_BYTES = 32 // what the on-chain NFT allows
const MAX_DESCRIPTION = 500
const MAX_STORED = 5_000 // stops the disk filling up

/**
 * The type of a picture judged by its first bytes, never by the name or the type the sender
 * claims. Only formats every browser shows safely: no SVG, which can carry scripts.
 */
export function sniffImage(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v)
  if (b.length < 12) return null
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/**
 * Hosts the picture and description of an NFT. The wallet uploads them, gets back a metadata link,
 * and puts that link on-chain when it mints. Reading is public; writing is rate limited and capped.
 */
export function nftRoutes(deps: {
  store: NftStore
  /** Where this server is reachable from a browser, used to build the links people will store. */
  publicUrl: string
  limiter: RateLimiter
  clientIp: (c: Context) => string
}) {
  const app = new Hono()
  const base = deps.publicUrl.replace(/\/+$/, '')

  app.post('/', bodyLimit({ maxSize: MAX_IMAGE_BYTES + 64 * 1024, onError: (c) => c.json({ error: 'That file is too large. Use a picture under 2 MB.' }, 413) }), async (c) => {
    if (!deps.limiter.hit(deps.clientIp(c)).ok) return c.json({ error: 'Too many uploads. Wait a minute and try again.' }, 429)
    if (deps.store.count() >= MAX_STORED) return c.json({ error: 'The server is full. Try again later.' }, 507)

    let form: Record<string, unknown>
    try {
      form = await c.req.parseBody()
    } catch {
      return c.json({ error: 'Send the picture as a form upload.' }, 400)
    }
    const file = form.image
    const name = typeof form.name === 'string' ? form.name.trim() : ''
    const description = typeof form.description === 'string' ? form.description.trim() : ''

    if (!(file instanceof File)) return c.json({ error: 'Choose a picture to upload.' }, 400)
    if (name.length === 0 || new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
      return c.json({ error: `Give the NFT a name of 1 to ${MAX_NAME_BYTES} characters.` }, 400)
    }
    if (description.length > MAX_DESCRIPTION) return c.json({ error: `The description can be at most ${MAX_DESCRIPTION} characters.` }, 400)
    if (file.size > MAX_IMAGE_BYTES) return c.json({ error: 'That file is too large. Use a picture under 2 MB.' }, 413)

    const image = new Uint8Array(await file.arrayBuffer())
    const mime = sniffImage(image)
    if (!mime) return c.json({ error: 'Use a PNG, JPEG, GIF or WebP picture.' }, 415)

    const id = await deps.store.save({ image, mime, name, description })
    return c.json({ id, metadataUrl: `${base}/nft/${id}/metadata.json`, imageUrl: `${base}/nft/${id}/image` }, 201)
  })

  // Metaplex's standard off-chain format: wallets and explorers know how to read this.
  app.get('/:id/metadata.json', async (c) => {
    const id = c.req.param('id')
    const info = isNftId(id) ? await deps.store.info(id) : null
    if (!info) return c.json({ error: 'Not found' }, 404)
    const image = `${base}/nft/${id}/image`
    c.header('Cache-Control', 'public, max-age=3600')
    return c.json({
      name: info.name,
      description: info.description,
      image,
      properties: { category: 'image', files: [{ uri: image, type: info.mime }] },
    })
  })

  app.get('/:id/image', async (c) => {
    const id = c.req.param('id')
    const info = isNftId(id) ? await deps.store.info(id) : null
    const bytes = info ? await deps.store.image(id) : null
    if (!info || !bytes) return c.json({ error: 'Not found' }, 404)
    return new Response(bytes, {
      headers: {
        'Content-Type': info.mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  })

  return app
}

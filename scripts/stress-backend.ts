// Hammers the running backend with awkward input and bursts of traffic, and reports what held.
//
//   bun run --cwd scripts stress-backend [http://localhost:3000]
//
// It only talks to the API (no real funds move). Run it against a local server.

const BASE = process.argv[2] ?? 'http://localhost:3000'
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const ip = (n: number) => ({ 'x-forwarded-for': `10.9.${Math.floor(n / 250)}.${n % 250}` })
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

// ---- basics
{
  const h = await (await fetch(BASE + '/health')).json()
  check('health answers', h.ok === true)
  const p = await fetch(BASE + '/prices')
  check('prices answers', p.status === 200)
  check('unknown route is a clean 404', (await fetch(BASE + '/nope')).status === 404)
}

// ---- faucet abuse
{
  for (const [name, body] of [
    ['empty body', ''],
    ['not json', '{{{'],
    ['no address', {}],
    ['number as address', { address: 5 }],
    ['bad address', { address: 'hello' }],
    ['huge address', { address: 'A'.repeat(100_000) }],
    ['array', []],
  ] as const) {
    const r = await post('/faucet', body as never, ip(1))
    check(`faucet rejects: ${name}`, r.status >= 400 && r.status < 500, `status ${r.status}`)
  }
  // a burst from one IP hits the limiter, and the server keeps answering
  const burst = await Promise.all(Array.from({ length: 40 }, () => post('/faucet', { address: 'hello' }, ip(2))))
  const codes = burst.map((r) => r.status)
  check('faucet burst is rate limited', codes.includes(429), `429s: ${codes.filter((c) => c === 429).length}/40`)
  check('server still healthy after the burst', (await fetch(BASE + '/health')).status === 200)
}

// ---- relay abuse: it must never sign anything that is not a claim
{
  for (const [name, body] of [
    ['not json', '<xml/>'],
    ['no transaction', {}],
    ['garbage transaction', { transaction: 'AAAA' }],
    ['huge transaction', { transaction: 'A'.repeat(200_000) }],
    ['non-string transaction', { transaction: { a: 1 } }],
  ] as const) {
    const r = await post('/relay', body as never, ip(3))
    check(`relay rejects: ${name}`, r.status >= 400 && r.status < 500, `status ${r.status}`)
  }
  const burst = await Promise.all(Array.from({ length: 60 }, () => post('/relay', { transaction: 'AAAA' }, ip(4))))
  check('relay burst is rate limited', burst.some((r) => r.status === 429))
}

// ---- announcements: parameters and load
{
  for (const q of ['?after=-1', '?after=abc', '?limit=0', '?limit=1.5', '?limit=-3', '?after=1e9x']) {
    const r = await fetch(BASE + '/announcements' + q, { headers: ip(5) })
    check(`announcements rejects ${q}`, r.status === 400, `status ${r.status}`)
  }
  const ok = await fetch(BASE + '/announcements?limit=100000', { headers: ip(6) })
  check('announcements caps a huge limit', ok.status === 200)
  const t0 = performance.now()
  const many = await Promise.all(Array.from({ length: 100 }, (_, i) => fetch(BASE + '/announcements', { headers: ip(100 + (i % 20)) })))
  const ms = Math.round(performance.now() - t0)
  check('100 concurrent announcement reads are answered', many.every((r) => r.status === 200 || r.status === 429), `${ms} ms`)
}

// ---- NFT uploads
{
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
  const upload = (image: Uint8Array | string, name: string, hdr: Record<string, string> = ip(7), fname = 'p.png') => {
    const f = new FormData()
    f.set('image', new File([image as BlobPart], fname, { type: 'image/png' }))
    f.set('name', name)
    return fetch(BASE + '/nft', { method: 'POST', body: f, headers: hdr })
  }
  const good = await upload(png, 'Stress')
  check('a real PNG uploads', good.status === 201, `status ${good.status}`)
  const meta = good.status === 201 ? await good.json() : null
  if (meta) {
    const img = await fetch(meta.imageUrl)
    check('the picture comes back with safe headers', img.headers.get('x-content-type-options') === 'nosniff' && img.headers.get('content-type') === 'image/png')
    const j = await (await fetch(meta.metadataUrl)).json()
    check('metadata points at the picture', j.image === meta.imageUrl && j.name === 'Stress')
  }
  check('SVG is refused even if named .png', (await upload(new TextEncoder().encode('<svg onload=alert(1)/>'), 'x', ip(8))).status === 415)
  check('an oversized file is refused', (await upload(new Uint8Array(3 * 1024 * 1024), 'big', ip(9))).status === 413)
  check('a path-traversal id is a 404', (await fetch(BASE + '/nft/..%2F..%2Fpackage.json/image')).status === 404)
  const burst = await Promise.all(Array.from({ length: 20 }, () => upload(png, 'burst', ip(10))))
  check('upload burst is rate limited', burst.some((r) => r.status === 429), `201s: ${burst.filter((r) => r.status === 201).length}`)
}

// ---- CORS: only the web app may call from a browser
{
  const evil = await fetch(BASE + '/prices', { headers: { origin: 'https://evil.example' } })
  check('a foreign origin gets no CORS approval', evil.headers.get('access-control-allow-origin') !== 'https://evil.example')
  const good = await fetch(BASE + '/prices', { headers: { origin: 'http://localhost:5173' } })
  check('the web app origin is allowed', good.headers.get('access-control-allow-origin') === 'http://localhost:5173')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)

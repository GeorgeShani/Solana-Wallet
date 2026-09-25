// Generates the logo files from the one fixed rosette in web/src/ui/brand.ts, so the favicon, the app icons
// and the share image can never drift from the mark inside the app.
//
//   bun run --cwd scripts brand-assets
//
// Writes into web/public/:  logo.svg, favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png, og-image.png
// The SVGs need nothing else. The PNGs are rendered with headless Edge/Chrome (set EDGE=/path/to/browser
// if it is not in the default place) and scaled with ffmpeg; without them the SVGs are still written.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BRAND_COLORS, BRAND_NAME, LOGO_LAYERS, LOGO_SEED } from '../web/src/ui/brand'
import { rosette } from '../web/src/ui/guillocheMath'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = resolve(ROOT, 'web/public')
const FONTS = resolve(ROOT, 'web/node_modules/@fontsource-variable')
const { plate, plateDeep, paper } = BRAND_COLORS

const mark = (detail: number) => rosette(LOGO_SEED, { size: 200, layers: LOGO_LAYERS, detail })
const paths = (detail: number) => mark(detail).paths.map((d) => `<path d="${d}"/>`).join('')

// ------------------------------------------------------------------ SVG files

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" stroke="${plate}" stroke-width="0.9" stroke-linejoin="round"><title>${BRAND_NAME}</title>${paths(220)}</svg>\n`
// the favicon sits on a teal tile with the rosette in paper ink, drawn a little heavier so it survives at 16px
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>${BRAND_NAME}</title><rect width="256" height="256" rx="56" fill="${plate}"/><g transform="translate(28 28) scale(1.0)" fill="none" stroke="${paper}" stroke-width="1.7" stroke-linejoin="round">${paths(110)}</g></svg>\n`

mkdirSync(PUBLIC, { recursive: true })
writeFileSync(join(PUBLIC, 'logo.svg'), logoSvg)
writeFileSync(join(PUBLIC, 'favicon.svg'), faviconSvg)
console.log('wrote logo.svg and favicon.svg')

// ------------------------------------------------------------------ PNG files

const edge =
  process.env.EDGE ??
  ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) =>
    Bun.file(p).size > 0,
  )
if (!edge) {
  console.log('No browser found for the PNG files: set EDGE=/path/to/edge-or-chrome. The SVGs are done.')
  process.exit(0)
}

const font = (family: string, pkg: string, file: string) =>
  `@font-face{font-family:'${family}';src:url('${pathToFileURL(join(FONTS, pkg, 'files', file)).href}') format('woff2');font-weight:100 900}`
const fonts = [
  font('Bodoni', 'bodoni-moda', 'bodoni-moda-latin-wght-normal.woff2'),
  font('Martian', 'martian-mono', 'martian-mono-latin-wght-normal.woff2'),
  font('Geist', 'geist', 'geist-latin-wght-normal.woff2'),
].join('')

// the app icon: full-bleed teal square (the phone rounds the corners itself), rosette with breathing room
const iconHtml = `<!doctype html><meta charset="utf-8"><style>*{margin:0}body{width:1024px;height:1024px;background:${plate};display:grid;place-items:center}
svg{width:760px;height:760px}</style>
<svg viewBox="0 0 200 200" fill="none" stroke="${paper}" stroke-width="1.6" stroke-linejoin="round">${paths(420)}</svg>`

// the share image (link previews): the mark on the plate, the name in the wallet's numeral face
const wall = rosette('solana wallet', { size: 200, layers: 4, detail: 220 }).paths.map((d) => `<path d="${d}"/>`).join('')
const ogHtml = `<!doctype html><meta charset="utf-8"><style>${fonts}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:radial-gradient(900px 500px at 30% 40%,#0a4a4e,${plateDeep});position:relative;overflow:hidden;color:${paper};font-family:Geist,sans-serif}
.wall{position:absolute;left:-150px;top:-390px;width:1500px;height:1500px;opacity:.13}
.mark{position:absolute;left:96px;top:135px;width:360px;height:360px}
.text{position:absolute;left:520px;top:0;bottom:0;right:80px;display:flex;flex-direction:column;justify-content:center}
h1{font-family:Bodoni,serif;font-weight:600;font-size:96px;line-height:1;letter-spacing:-1px}
p{margin-top:26px;font-size:30px;line-height:1.35;color:#b9d6d1;max-width:560px}
.micro{position:absolute;left:0;right:0;bottom:30px;text-align:center;font:500 15px Martian,monospace;letter-spacing:.34em;text-transform:uppercase;color:#6fb9b3}
.rule{width:96px;height:4px;margin-top:30px;border-radius:2px;background:linear-gradient(105deg,#2bb5a8,#7a5cff 45%,#e0b04a)}
</style>
<svg class="wall" viewBox="0 0 200 200" fill="none" stroke="#46c6bd" stroke-width=".3">${wall}</svg>
<svg class="mark" viewBox="0 0 200 200" fill="none" stroke="${paper}" stroke-width="1.1" stroke-linejoin="round">${paths(320)}</svg>
<div class="text"><h1>${BRAND_NAME}</h1><div class="rule"></div><p>Send, swap, lock funds, pay privately and mint NFTs on Solana devnet.</p></div>
<div class="micro">Solana devnet · test tokens have no value</div>`

const work = mkdtempSync(join(tmpdir(), 'brand-'))
async function render(name: string, html: string, width: number, height: number): Promise<string> {
  const page = join(work, `${name}.html`)
  const out = join(work, `${name}.png`)
  writeFileSync(page, html)
  const proc = Bun.spawn(
    [edge!, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${width},${height}`, '--virtual-time-budget=6000', `--screenshot=${out}`, pathToFileURL(page).href],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  await proc.exited
  if (!(await Bun.file(out).exists())) throw new Error(`The browser did not produce ${name}.png`)
  return out
}
async function scale(src: string, size: number, dest: string) {
  const p = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${size}:${size}:flags=lanczos`, dest], { stdout: 'ignore', stderr: 'inherit' })
  if ((await p.exited) !== 0) throw new Error('ffmpeg failed')
}

try {
  const big = await render('icon', iconHtml, 1024, 1024)
  for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]] as const) {
    await scale(big, size, join(PUBLIC, name))
    console.log('wrote', name)
  }
  const og = await render('og', ogHtml, 1200, 630)
  await Bun.write(join(PUBLIC, 'og-image.png'), Bun.file(og))
  console.log('wrote og-image.png')
} finally {
  rmSync(work, { recursive: true, force: true })
}

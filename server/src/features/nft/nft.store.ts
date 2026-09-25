import { mkdirSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Picture bytes in a plain ArrayBuffer, which is what a Response body accepts. */
export type Bytes = Uint8Array<ArrayBuffer>

/** What an NFT's off-chain data looks like once stored. */
export interface StoredNft {
  name: string
  description: string
  mime: string
}

/**
 * Holds the pictures and text behind NFTs. The chain only keeps a short link, so someone has to
 * serve the rest; here that is this server. Nothing in a store is secret: it is all public.
 */
export interface NftStore {
  save(input: StoredNft & { image: Bytes }): Promise<string>
  info(id: string): Promise<StoredNft | null>
  image(id: string): Promise<Bytes | null>
  count(): number
}

/** Ids are random hex, and nothing else is ever used to build a file name. */
export const isNftId = (id: string) => /^[a-f0-9]{32}$/.test(id)

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

/** Files on disk: `<id>.img` for the picture and `<id>.json` for the rest. */
export function createFileNftStore(dir: string): NftStore {
  mkdirSync(dir, { recursive: true })
  return {
    async save({ image, ...info }) {
      const id = newId()
      await writeFile(join(dir, `${id}.img`), image)
      await writeFile(join(dir, `${id}.json`), JSON.stringify(info))
      return id
    },
    async info(id) {
      if (!isNftId(id)) return null
      try {
        return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')) as StoredNft
      } catch {
        return null
      }
    },
    async image(id) {
      if (!isNftId(id)) return null
      try {
        return new Uint8Array(await readFile(join(dir, `${id}.img`)))
      } catch {
        return null
      }
    },
    count: () => readdirSync(dir).filter((f) => f.endsWith('.json')).length,
  }
}

/** Everything in memory (tests). */
export function createMemoryNftStore(): NftStore {
  const items = new Map<string, StoredNft & { image: Bytes }>()
  return {
    async save(input) {
      const id = newId()
      items.set(id, input)
      return id
    },
    async info(id) {
      const it = items.get(id)
      return it ? { name: it.name, description: it.description, mime: it.mime } : null
    },
    async image(id) {
      return items.get(id)?.image ?? null
    },
    count: () => items.size,
  }
}

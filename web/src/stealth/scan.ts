import { addressToPublicKey, scanAnnouncement, type StealthKeys } from '@wallet/shared'
import { getAnnouncements, type AnnouncementItem } from '../api'

/** A payment addressed to this wallet, with the private key that controls the one-time address. */
export interface FoundPayment {
  /** The one-time address. */
  address: string
  /** Its private scalar: only ever kept in memory while the wallet is unlocked. */
  scalar: bigint
  signature: string
  blockTime: number | null
}

/** Which of these announcements are payments to `keys`? Duplicates of one address are merged. */
export function findMyPayments(keys: StealthKeys, items: AnnouncementItem[]): FoundPayment[] {
  const found = new Map<string, FoundPayment>()
  for (const item of items) {
    let hit
    try {
      hit = scanAnnouncement(keys, {
        ephemeral: addressToPublicKey(item.ephemeral),
        stealthPub: addressToPublicKey(item.stealth),
        viewTag: item.viewTag,
      })
    } catch {
      continue // a malformed announcement can't be ours
    }
    if (hit && !found.has(item.stealth)) {
      found.set(item.stealth, {
        address: item.stealth,
        scalar: hit.privateScalar,
        signature: item.signature,
        blockTime: item.blockTime,
      })
    }
  }
  return [...found.values()]
}

/** Downloads the whole public feed (in pages) and returns what is ours. */
export async function scanFeed(keys: StealthKeys): Promise<{ payments: FoundPayment[]; scanned: number }> {
  const items: AnnouncementItem[] = []
  let after = 0
  for (let page = 0; page < 50; page++) {
    const res = await getAnnouncements(after, 1000)
    items.push(...res.items)
    if (res.items.length < 1000) break
    after = res.items[res.items.length - 1].id
  }
  return { payments: findMyPayments(keys, items), scanned: items.length }
}

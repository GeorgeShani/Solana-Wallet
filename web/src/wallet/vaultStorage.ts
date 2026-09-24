import type { EncryptedVault } from './vaultCrypto'

// Minimal IndexedDB key-value wrapper. Only the *encrypted* vault is stored.
const DB = 'solana-wallet'
const STORE = 'kv'
const KEY = 'vault'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const loadVault = () => tx<EncryptedVault | undefined>('readonly', (s) => s.get(KEY))
export const saveVault = (v: EncryptedVault) => tx('readwrite', (s) => s.put(v, KEY))
export const deleteVault = () => tx('readwrite', (s) => s.delete(KEY))

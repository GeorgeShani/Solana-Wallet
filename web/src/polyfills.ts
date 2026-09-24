// WDK's Solana module uses the Node global `Buffer`.
import { Buffer } from 'buffer'

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
if (!g.Buffer) g.Buffer = Buffer

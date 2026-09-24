// Tiny little-endian encoders for instruction data.

export const u8 = (n: number): Uint8Array => Uint8Array.of(n & 0xff)

export function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}

export function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

export function u64(n: bigint): Uint8Array {
  if (n < 0n || n >= 2n ** 64n) throw new RangeError(`${n} does not fit in a u64`)
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, true)
  return b
}

export function i64(n: bigint): Uint8Array {
  if (n < -(2n ** 63n) || n >= 2n ** 63n) throw new RangeError(`${n} does not fit in an i64`)
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigInt64(0, n, true)
  return b
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export function readI64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true)
}

export function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true)
}

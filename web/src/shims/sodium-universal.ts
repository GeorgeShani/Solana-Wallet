// Browser stand-in for `sodium-universal`. WDK's Solana module only uses
// sodium_memzero (to wipe private key bytes on dispose()); the real package
// pulls in the Node-only `sodium-native` addon, which can't be bundled.
export function sodium_memzero(buf: Uint8Array): void {
  buf.fill(0)
}
export default { sodium_memzero }

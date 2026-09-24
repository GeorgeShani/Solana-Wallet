import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // WDK's Solana module imports `sodium-universal` (Node-only native addon)
      // just to zero key bytes; swap in a pure-JS shim for the browser build.
      'sodium-universal': fileURLToPath(new URL('./src/shims/sodium-universal.ts', import.meta.url)),
    },
  },
})

// The wallet's logo is one fixed guilloche rosette. Every other rosette in the app is drawn from an
// address (an account, a token, an NFT); this one is drawn from a constant, so it never changes.
// Do not change these values: the favicon, the app icons and the share image are all generated from them
// (bun run --cwd scripts brand-assets), and the tests pin the geometry.

/** The text the logo's rosette is drawn from. */
export const LOGO_SEED = 'welcome back'
export const LOGO_LAYERS = 3

/** The product name shown next to the mark. */
export const BRAND_NAME = 'Solana Wallet'

/** Brand inks (the same values as the theme colours in index.css). */
export const BRAND_COLORS = { plate: '#0b4d50', plateDeep: '#052a2d', paper: '#e4efec', note: '#f4faf8' } as const

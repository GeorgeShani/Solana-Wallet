# Solana Wallet

A self-custodial crypto wallet for **Solana devnet**, built as a project for a Solana course. It holds SOL, SPL tokens and (soon) NFTs, and lets you **send** and **swap** them. The swap runs on our own on-chain program. Private payments come after that.

> **Devnet only.** Every token in this project is a free test token with no real value. Do not put real funds or a real seed phrase into it.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Workspace scaffold, Tether WDK running in the browser | Done |
| 1 | Core wallet: create/import, encrypted vault, balances, **Send**, Receive, Activity | Done |
| 2 | Anchor program: constant-product AMM, **Swap** UI | Planned |
| 3 | Hono backend: faucet, prices, fee relayer, indexer | Planned |
| 4 | Private claim-link payments | Planned |
| 5 | Time-locked / vesting transfers | Planned |
| 6 | Stealth addresses | Planned |
| 7 | NFT gallery + mint | Planned |
| 8 | Polish, docs | Planned |

The `anchor/` program and the `server/` app are still the generated starter templates (a counter program and "Hello Hono"). They are replaced in Phases 2 and 3.

## What works today (Phase 1)

- **Create or import a wallet.** A 12-word recovery phrase is generated in the browser, and you must re-enter three random words to prove you backed it up.
- **Encrypted vault.** The phrase is encrypted with your password (PBKDF2-SHA256, 600,000 iterations, then AES-256-GCM) and only the ciphertext is stored, in IndexedDB. The wallet locks after 5 minutes of inactivity, and locking wipes the derived keys from memory.
- **Multiple accounts** derived from one seed phrase (`m/44'/501'/{i}'/0'`).
- **Dashboard** with SOL and SPL token balances, a copyable address, and a devnet airdrop button.
- **Send** SOL or any SPL token: address validation, a fee quote, a review screen, and an explorer link after sending. The review screen shows extra costs up front:
  - a recipient who has no token account for that token needs one created, which costs rent that you pay;
  - a brand-new recipient account needs a minimum SOL balance.

  Both amounts are read from the network, because devnet's rent parameters change.
- **Receive** with an address QR code, **Activity** history, and **Settings** (reveal recovery phrase with your password, remove wallet).

## Tech stack

| Layer | Tools |
| --- | --- |
| Wallet SDK | [Tether WDK](https://docs.wdk.tether.io) `@tetherto/wdk-wallet-solana` (key derivation, signing, transfers) |
| Web app | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query |
| Solana libraries | `@solana/*` 3.0.3 (the version WDK is built on) |
| On-chain program | Rust, Anchor 1.1.2, tested with LiteSVM |
| Backend (optional) | Hono on bun |
| Tooling | bun workspaces; Rust, Anchor and the Solana CLI run in WSL |

## Folder structure

```
Solana-Wallet/
├── package.json          bun workspace root (web, server, packages/*)
├── anchor/               Anchor workspace, the on-chain Rust program
│   ├── Anchor.toml
│   └── programs/wallet_program/
│       ├── src/          program code (instructions/, state.rs, error.rs)
│       └── tests/        Rust tests using LiteSVM
├── web/                  React app (the wallet UI)
│   └── src/
│       ├── wallet/       WalletContext, WDK wrapper, vault crypto/storage, RPC helpers
│       ├── pages/        Onboarding, Unlock, Dashboard, Send, Receive, Activity, Settings
│       ├── components/   Layout, CopyButton
│       ├── lib/          number formatting and parsing
│       ├── shims/        browser stand-in for a Node-only WDK dependency
│       └── config.ts     network, RPC URL, known tokens, explorer links
├── server/               Hono backend (faucet, relayer, prices, indexer in Phase 3)
├── packages/             planned: code shared across the projects above
│   ├── program-client/     typed client generated from the Anchor IDL
│   └── shared/             program ID, devnet mint/pool addresses, stealth crypto
└── scripts/              planned: one-off scripts, e.g. seed-devnet.ts
```

### What is `packages/` for?

Several parts of the project need the same code: the web app, the server, and the seed script all talk to our Anchor program. `packages/` holds that shared code so it exists once:

- **`program-client`:** generated (with [Codama](https://github.com/codama-idl/codama)) from the program's IDL, the machine-readable description of its instructions. It gives every consumer typed functions instead of hand-encoded instruction bytes.
- **`shared`:** constants and pure logic used on both sides, such as the program ID, the devnet token and pool addresses, and the stealth-address math. Sharing it lets the server's tests check the same code the web app runs.

Both are workspace packages, so other folders import them by name. They arrive with Phase 2, which is why the folders don't exist in git yet.

## Getting started

### Prerequisites

- [bun](https://bun.sh) (on Windows, for `web/` and `server/`)
- For the on-chain program: Rust, Anchor and the Solana CLI, installed in WSL

### Run the web app

```bash
bun install
bun run dev:web
```

Open http://localhost:5173, create a wallet, and press **Get SOL**. The public devnet faucet is rate-limited. If it refuses, use https://faucet.solana.com with your wallet address, or send yourself devnet SOL from the Solana CLI.

Optional: set `VITE_RPC_URL` in `web/.env` to use your own devnet RPC endpoint (for example a Helius key) instead of the public one.

### Build and test the Anchor program

The project lives on the Windows filesystem, so run the Rust tools through WSL and quote the path (it contains spaces):

```bash
wsl -e bash -lc "cd '/mnt/c/Users/<you>/<path to>/Solana-Wallet/anchor' && anchor build"
wsl -e bash -lc "cd '/mnt/c/Users/<you>/<path to>/Solana-Wallet/anchor' && cargo test"
```

Builds on `/mnt/c` are slower than on the Linux filesystem; that is expected.

### Tests and checks

```bash
bun test                 # unit tests: vault encryption, number formatting
bun run --cwd web build  # type-check + production build
bun run --cwd web lint
```

Send was also verified end to end in a real browser against devnet: a SOL send and an SPL token send that created the recipient's token account, each cross-checked with the Solana CLI.

## How the wallet works

- **Your seed phrase is your wallet.** The 12 words are the master secret; every account and key is derived from them. The password only protects the copy stored in this browser. It cannot recover a lost phrase.
- **Keys never leave the browser.** Signing happens locally through WDK. The RPC node only sees signed transactions.
- **SPL token balances live in token accounts.** Sending a token to someone who has never held it creates their account first, and the sender pays the rent deposit.

### Notes for contributors

- **WDK in the browser.** WDK targets Node.js. Two small shims make it run in Vite: `web/src/polyfills.ts` provides the `Buffer` global, and `web/src/shims/sodium-universal.ts` replaces a native Node module that WDK uses only to zero key bytes. The alias is set in `web/vite.config.ts`.
- **Library versions.** WDK is built on `@solana/*` 3.0.3, so our own Solana code pins that version to keep transaction types compatible.
- **Never hard-code rent.** Rent-exempt minimums change between clusters and over time, so the app asks the RPC (`getMinimumBalanceForRentExemption`).

## Roadmap

1. **Swap.** An Anchor program with a constant-product pool (`x * y = k`) and a swap UI with quotes, price impact and slippage protection. Real swap aggregators support only mainnet, so we run our own devnet AMM with test tokens.
2. **Backend.** A devnet token faucet, price proxy, and a fee relayer so recipients with 0 SOL can still claim funds.
3. **Extras.** Claim-link payments (send funds to a link, not an address), time-locked and vesting transfers, stealth addresses (one-time addresses so payments can't be linked to your main address), and an NFT gallery with minting.

## Security notes

- Devnet only, with no real value at stake. Not audited; do not use it for real funds.
- The encrypted vault is only as strong as your password.
- Anyone who has your recovery phrase controls your funds.
- Program deploy keypairs (`anchor/target/deploy/*-keypair.json`), `.env` files and key files are git-ignored. Never commit them.

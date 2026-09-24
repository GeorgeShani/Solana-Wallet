# Solana Wallet

A self-custodial crypto wallet for **Solana devnet**, built as a project for a Solana course. It holds SOL, SPL tokens and (soon) NFTs, and lets you **send** and **swap** them. Swaps run on our own on-chain program, an automated market maker written in Rust with Anchor. Private payments come after that.

> **Devnet only.** Every token in this project is a free test token with no real value. Do not put real funds or a real seed phrase into it.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Workspace scaffold, Tether WDK running in the browser | Done |
| 1 | Core wallet: create/import, encrypted vault, balances, **Send**, Receive, Activity | Done |
| 2 | Anchor AMM program deployed to devnet, **Swap** UI | Done |
| 3 | Hono backend: faucet, prices, fee relayer, indexer | Planned |
| 4 | Private claim-link payments | Planned |
| 5 | Time-locked / vesting transfers | Planned |
| 6 | Stealth addresses | Planned |
| 7 | NFT gallery + mint | Planned |
| 8 | Polish, docs | Planned |

The `server/` app is still the generated "Hello Hono" starter; it is replaced in Phase 3.

## What works today

**Wallet (Phase 1)**

- **Create or import a wallet.** A 12-word recovery phrase is generated in the browser, and you must re-enter three random words to prove you backed it up.
- **Encrypted vault.** The phrase is encrypted with your password (PBKDF2-SHA256, 600,000 iterations, then AES-256-GCM) and only the ciphertext is stored, in IndexedDB. The wallet locks after 5 minutes of inactivity, and locking wipes the derived keys from memory.
- **Multiple accounts** derived from one seed phrase (`m/44'/501'/{i}'/0'`).
- **Dashboard** with SOL and SPL token balances, a copyable address, and a devnet airdrop button.
- **Send** SOL or any SPL token: address validation, a fee quote, a review screen, and an explorer link once the network has confirmed the transaction. The review screen shows extra costs up front (rent for a new token account, the minimum balance of a brand-new account). Those amounts are read from the network, because devnet's rent parameters change.
- **Receive** with an address QR code, **Activity** history, and **Settings** (reveal recovery phrase with your password, remove wallet).

**Swap (Phase 2)**

- Swap between **SOL**, **tUSDC** and **tBONK** (test tokens) through three on-chain pools.
- Live quote with rate, **price impact**, pool fee and the **minimum you will receive**. Trades that move the price by 5% or more ask for an explicit OK, and 15% or more are refused.
- Adjustable **slippage tolerance** (0.1%, 0.5%, 1% or custom). If the price moves further than that before the trade lands, the program cancels it and nothing is swapped.
- SOL is handled automatically: the app wraps it into wSOL, swaps, and unwraps it in the same transaction, so a failed swap leaves the wallet untouched.
- Swaps appear in Activity as `-0.02 SOL → +2.932525 tUSDC`.

## Tech stack

| Layer | Tools |
| --- | --- |
| Wallet SDK | [Tether WDK](https://docs.wdk.tether.io) `@tetherto/wdk-wallet-solana` (key derivation, signing, transfers) |
| Web app | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query |
| Solana libraries | `@solana/*` 3.0.3 (the version WDK is built on) |
| On-chain program | Rust, Anchor 1.1.2, `anchor-spl`, tested with LiteSVM |
| Backend (optional) | Hono on bun |
| Tooling | bun workspaces; Rust, Anchor and the Solana CLI run in WSL |

## Folder structure

```
Solana-Wallet/
├── package.json          bun workspace root (web, server, scripts, packages/*)
├── anchor/               Anchor workspace, the on-chain Rust program
│   ├── Anchor.toml
│   ├── idl/              wallet_program.json, the program's machine-readable interface (committed)
│   └── programs/wallet_program/
│       ├── src/
│       │   ├── lib.rs          the four instructions
│       │   ├── math.rs         pure pool arithmetic, unit-tested
│       │   ├── state.rs        the Pool account
│       │   ├── constants.rs    seeds, fee limits
│       │   ├── error.rs        custom errors
│       │   └── instructions/   init_pool, liquidity (add + remove), swap
│       └── tests/test_amm.rs   21 integration tests running the compiled program in LiteSVM
├── web/                  React app (the wallet UI)
│   └── src/
│       ├── wallet/       WalletContext, WDK wrapper, vault crypto/storage, RPC helpers
│       ├── swap/         pool reserves and quoting, swap transaction builder
│       ├── pages/        Onboarding, Unlock, Dashboard, Send, Swap, Receive, Activity, Settings
│       ├── components/   Layout, CopyButton
│       ├── lib/          number formatting, error translation
│       ├── shims/        browser stand-in for a Node-only WDK dependency
│       └── config.ts     network, RPC URL, known tokens, explorer links
├── packages/             code shared by web, scripts and (later) the server
│   ├── shared/           AMM math in TypeScript, devnet addresses (devnet.json)
│   └── program-client/   typed client for the program: PDAs, instruction builders, decoders
├── scripts/              seed-devnet.ts: creates the test tokens and pools
├── server/               Hono backend (faucet, relayer, prices, indexer in Phase 3)
└── keys/                 git-ignored: the admin wallet's seed phrase
```

### What is `packages/` for?

Several parts of the project need the same code: the web app and the seed script both talk to our Anchor program, and the server will too. `packages/` holds that shared code so it exists once.

- **`shared`:** the AMM math ported to TypeScript (the UI uses it to quote trades; the program recomputes the same numbers on-chain) and `devnet.json`, the addresses of the program, tokens and pools. The tests check the same numbers as the Rust tests, so the UI quote and the on-chain result cannot drift apart.
- **`program-client`:** builds the program's instructions from the IDL, so account order and roles always match the program. It also derives the pool and vault addresses and decodes pool accounts, plus the few System/Token/Associated-Token instructions a swap needs. It replaces what a code generator such as Codama would produce, because the generators target a newer `@solana/kit` than the 3.0.3 line WDK is built on.

Other folders import them by name (`@wallet/shared`, `@wallet/program-client`).

## The swap program

`wallet_program` is deployed on devnet at [`6rAZLb32wv86p3uhqQQCZpDxn4BYiFBX7tqPvw7HpD27`](https://explorer.solana.com/address/6rAZLb32wv86p3uhqQQCZpDxn4BYiFBX7tqPvw7HpD27?cluster=devnet). It is a constant-product AMM: each pool holds two tokens and keeps `reserve_a × reserve_b` from shrinking, so the price moves as people trade.

| Instruction | What it does |
| --- | --- |
| `init_pool(fee_bps)` | Creates an empty pool for a pair of mints, its LP-token mint and its two vaults. Mints are passed in sorted order so each pair has exactly one pool. |
| `add_liquidity(a, b, min_lp)` | Deposits the largest amounts in the pool's ratio that fit within `a` and `b`, and mints LP tokens for the share. |
| `remove_liquidity(lp, min_a, min_b)` | Burns LP tokens and returns the matching share of both reserves. |
| `swap(amount_in, min_out, a_to_b)` | Trades an exact input for at least `min_out`. The fee (0.3%) is taken from the input and stays in the pool. |

Design notes:

- **Slippage protection is enforced on-chain.** Every instruction takes a minimum-out or minimum-LP argument and fails with `SlippageExceeded` rather than pay less.
- **Minimum liquidity.** The first deposit permanently locks 1,000 LP shares, which stops the "inflate the share price on an empty pool" attack.
- **Accounts are validated.** Vaults must be the pool's own associated token accounts, and user accounts must belong to the signer. Tests try fake vaults, someone else's token account and someone else's LP tokens.
- **Classic SPL Token only.** Token-2022 mints are not supported. SOL takes part as wrapped SOL, which is a classic token.
- **Large accounts are boxed** (`Box<Account<…>>`) to stay under the Solana VM's 4 KB stack limit. The integration tests caught this: without it `add_liquidity` crashed at runtime even though it compiled.

### Devnet pools

`scripts/seed-devnet.ts` created the test tokens and seeded three pools with consistent prices (1 SOL = 150 tUSDC = 6,000,000 tBONK). Their addresses are in `packages/shared/src/devnet.json`. The pools are small (1 SOL deep), so large trades show a big price impact by design.

## Getting started

### Prerequisites

- [bun](https://bun.sh) (on Windows, for `web/`, `server/`, `scripts/` and `packages/`)
- For the on-chain program: Rust, Anchor and the Solana CLI, installed in WSL

### Run the web app

```bash
bun install
bun run dev:web
```

Open http://localhost:5173, create a wallet, and press **Get SOL**. The public devnet faucet is rate-limited. If it refuses, use https://faucet.solana.com with your wallet address, or send yourself devnet SOL from the Solana CLI. Then open **Swap**.

Optional: set `VITE_RPC_URL` in `web/.env` to use your own devnet RPC endpoint (for example a Helius key) instead of the public one.

### Build and test the Anchor program

The project lives on the Windows filesystem, so run the Rust tools through WSL and quote the path (it contains spaces). **Point Cargo's build directory at the WSL filesystem.** Compiling on `/mnt/c` is very slow (a first build took over 10 minutes there); on the native filesystem it takes about two minutes and incremental builds take seconds.

```bash
wsl -e bash -lc "export CARGO_TARGET_DIR=\$HOME/.cache/solana-wallet-target; cd '/mnt/c/Users/<you>/<path to>/Solana-Wallet/anchor' && anchor build && cargo test"
```

`anchor build` also regenerates the IDL at `$CARGO_TARGET_DIR/idl/wallet_program.json`; copy it to `anchor/idl/` and commit it whenever the program's interface changes.

Program keypairs are git-ignored. On a fresh clone, run `anchor keys sync` to generate a new program ID, then redeploy and re-run the seed script. Note that with `CARGO_TARGET_DIR` set, `anchor build` may generate a stray keypair in that directory; deploy with the keypair whose address matches `declare_id!`:

```bash
solana program deploy $CARGO_TARGET_DIR/deploy/wallet_program.so --program-id <path to the matching keypair>
```

### Seed the devnet pools

```bash
bun run --cwd scripts seed-devnet
```

The first run creates `keys/admin-seed.txt` (git-ignored), prints the admin wallet's address and asks you to fund it with about 2.5 devnet SOL. Run it again and it creates the tokens and pools, then writes `packages/shared/src/devnet.json`. It is safe to re-run: existing tokens and pools are detected and skipped. The admin wallet is also the mint authority of the test tokens (the Phase 3 faucet will use it).

### Tests and checks

```bash
bun test                 # 29 TypeScript tests: vault crypto, formatting, AMM math, program client, errors
bun run build:web        # type-check + production build
bun run --cwd web lint
```

The Rust side has 8 unit tests (pool arithmetic) and 21 LiteSVM integration tests (`cargo test`, see above). Send and Swap were also verified end to end in a real browser against devnet, with every result cross-checked from the Solana CLI: SOL send, SPL send that created the recipient's token account, SOL→tUSDC, tUSDC→SOL (unwrap) and tUSDC→tBONK swaps.

## How the wallet works

- **Your seed phrase is your wallet.** The 12 words are the master secret; every account and key is derived from them. The password only protects the copy stored in this browser. It cannot recover a lost phrase.
- **Keys never leave the browser.** Signing happens locally through WDK. The RPC node only sees signed transactions.
- **SPL token balances live in token accounts.** Sending a token to someone who has never held it creates their account first, and the sender pays the rent deposit.
- **Success means confirmed.** WDK only broadcasts a transaction, so the app polls the network and reports success or the on-chain failure reason, translated with the program's own error messages.

### Notes for contributors

- **WDK in the browser.** WDK targets Node.js. Two small shims make it run in Vite: `web/src/polyfills.ts` provides the `Buffer` global, and `web/src/shims/sodium-universal.ts` replaces a native Node module that WDK uses only to zero key bytes. The alias is set in `web/vite.config.ts`.
- **Library versions.** WDK is built on `@solana/*` 3.0.3, so our own Solana code pins that version to keep transaction types compatible.
- **Never hard-code rent.** Rent-exempt minimums change between clusters and over time, so the app asks the RPC (`getMinimumBalanceForRentExemption`).
- **Keep the math in sync.** `packages/shared/src/amm.ts` mirrors `anchor/programs/wallet_program/src/math.rs`. Change both together; the tests use the same vectors.

## Roadmap

1. **Backend (Phase 3).** A devnet token faucet, price proxy, and a fee relayer so recipients with 0 SOL can still claim funds.
2. **Extras (Phases 4–7).** Claim-link payments (send funds to a link, not an address), time-locked and vesting transfers, stealth addresses (one-time addresses so payments can't be linked to your main address), and an NFT gallery with minting.
3. **Later.** A liquidity page in the UI (the program already supports adding and removing liquidity), and multi-hop swap routing.

## Security notes

- Devnet only, with no real value at stake. Not audited; do not use it for real funds.
- The encrypted vault is only as strong as your password.
- Anyone who has your recovery phrase controls your funds.
- Program keypairs (`anchor/target/deploy/*-keypair.json`), the admin seed (`keys/`) and `.env` files are git-ignored. Never commit them.

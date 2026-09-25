# Solana Wallet

A self-custodial crypto wallet for **Solana devnet**, built as a project for a Solana course. It holds SOL, SPL tokens and NFTs, and lets you **send**, **swap**, **send by link**, **lock funds until a date**, **receive privately** with stealth addresses, and **mint and send NFTs**. Swaps, links, locks and stealth announcements run on our own on-chain program written in Rust with Anchor.

> **Devnet only.** Every token in this project is a free test token with no real value. Do not put real funds or a real seed phrase into it.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Workspace scaffold, Tether WDK running in the browser | Done |
| 1 | Core wallet: create/import, encrypted vault, balances, **Send**, Receive, Activity | Done |
| 2 | Anchor AMM program deployed to devnet, **Swap** UI | Done |
| 3 | Hono backend: test-token faucet, price feed, fee relayer | Done |
| 4 | **Claim links**: private "send by link" payments | Done |
| 5 | **Locks**: time-locked / vesting transfers | Done |
| 6 | **Stealth addresses** and the announcement indexer | Done |
| 7 | **NFTs**: gallery, mint from a picture, send (Metaplex Core) | Done |
| 8 | Polish: new design, toasts, crash screen, docs | Done |

## What works today

**Wallet (Phase 1)**

- **Create or import a wallet.** A 12-word recovery phrase is generated in the browser, and you must re-enter three random words to prove you backed it up.
- **Encrypted vault.** The phrase is encrypted with your password (PBKDF2-SHA256, 600,000 iterations, then AES-256-GCM) and only the ciphertext is stored, in IndexedDB. The wallet locks after 5 minutes of inactivity, and locking wipes the derived keys from memory.
- **Multiple accounts** derived from one seed phrase (`m/44'/501'/{i}'/0'`).
- **Dashboard** with SOL and SPL token balances, a USD estimate for SOL, and buttons for a devnet airdrop and for free test tokens.
- **Send** SOL or any SPL token: address validation, a fee quote, a review screen, and an explorer link once the network has confirmed the transaction. The review screen shows extra costs up front (rent for a new token account, the minimum balance of a brand-new account), read from the network because devnet's rent parameters change.
- **Receive** with an address QR code, **Activity** history, and **Settings** (reveal recovery phrase with your password, remove wallet).

**Swap (Phase 2)**

- Swap between **SOL**, **tUSDC** and **tBONK** (test tokens) through three on-chain pools.
- Live quote with rate, **price impact**, pool fee and the **minimum you will receive**. Trades that move the price by 5% or more ask for an explicit OK, and 15% or more are refused.
- Adjustable **slippage tolerance**. If the price moves further than that before the trade lands, the program cancels it and nothing is swapped.
- SOL is wrapped and unwrapped automatically inside the same transaction, so a failed swap leaves the wallet untouched.
- Swaps appear in Activity as `-0.02 SOL → +2.932525 tUSDC`.

**Backend (Phase 3)**

- **Faucet:** mints 100 tUSDC and 1,000,000 tBONK to any address, once per address per day.
- **Prices:** the SOL/USD price, cached, shown on the dashboard.
- **Fee relayer:** pays the network fee for claim transactions, so a recipient with no SOL can still claim. It signs only a strict allow-list of transactions (see below).

**Claim links (Phase 4)**

- On the **Links** page, lock SOL or any SPL token behind a link. The link is `…/claim#<secret>`. Send it to someone and they open it, paste **any address**, and claim. They need no SOL and no wallet, and you never need to know their address.
- The sender picks an expiry (1 hour to 30 days). After it the link can't be claimed, but the sender can **cancel** it at any time and get the funds and deposits back.
- The **Claim** page is public and works without a wallet. It shows the amount and sender, checks the link on-chain, and reports clearly if the link was already claimed, cancelled, expired or malformed.
- **What "private" means here (honestly):** the secret lives after the `#`, which browsers never send to any server, and only the matching *public* key goes on-chain. The sender does not reveal or need the recipient's address when sending. But the payment is still visible on-chain: an observer can see that a deposit into an escrow account was later paid out to some address, and can link the two if they watch the escrow. For unlinkable payments see stealth addresses below.

**Locks (Phase 5)**

- On the **Locks** page, send SOL or any token so that it **unlocks at a date** (all at once) or **vests gradually** between a start and an end, optionally with a cliff before which nothing is available. Presets such as "unlock in 5 minutes" make it easy to try.
- The recipient sees incoming locks with a progress bar and can **withdraw what has unlocked so far**, any time, in as many steps as they like.
- A lock can be made **cancellable**. Cancelling pays the recipient what they have earned up to that moment and returns the rest to the sender; the schedule is frozen at that point, so a cancel can never take back anything already earned. Non-cancellable locks can't be undone by anyone: that is the point.
- SOL is wrapped into wSOL and unwrapped inside the same transaction, so locks are token-only on-chain. The sender pays the rent for the lock's accounts and gets it back when the lock is closed.

**Stealth addresses (Phase 6)**

- On the **Stealth** page you get a public **stealth address** (`stealth:…`). Anyone can pay to it, but every payment goes to a **fresh one-time address** that only you can link to yourself. Two payments to you look unrelated on a block explorer.
- **Paying** someone's stealth address works for SOL and tokens. The payment and a small public note (the *announcement*) go in one transaction.
- **Receiving:** the wallet reads the announcements from the backend, tests each one with your scan key, and lists the ones meant for you under "Private payments to you".
- **Withdrawing:** the one-time address holds your money and only you can sign for it. Withdraw sends it to an address you choose; the one-time address pays its own fee, so nothing else is needed.
- **What "private" means here (honestly):** an observer can't tell who a stealth payment is for. But the *sender* is visible, and if you sweep the money straight into your main wallet you re-link it yourself. For real privacy, spend from the one-time address or move it to a fresh address. This is a learning implementation and has not been audited.

**NFTs (Phase 7)**

- The **NFTs** tab lists every Metaplex Core NFT the account owns, read straight from devnet (no API key or indexer). **Mint** turns a picture (PNG, JPEG, GIF or WebP up to 2 MB) into an NFT: the backend stores the picture and a small metadata file, the wallet then mints with a link to it. **Send** moves an NFT to another address.
- The NFT is one small account holding the owner, name and metadata link, so minting costs about 0.002 test SOL. The picture lives on this app's server, so the server's public address (`PUBLIC_URL`) is written into every NFT you mint.

**Design (Phase 8)**

The wallet is drawn as a banknote ("The Engraved Note"): cool bank-note paper on a teal printing plate, one teal line ink, one red serial ink for ids and alerts, and colour-shift foil for "confirmed". Every address (account, token, NFT) prints its own unique guilloche rosette, and every confirmed transaction is a receipt struck line by line. The layout is a Phantom-style 420px app frame with a five-tab bar that fills the screen on a phone. See [`web/PRODUCT.md`](web/PRODUCT.md) for the product brief and the screenshots in [`docs/screenshots/`](docs/screenshots).

## Tech stack

| Layer | Tools |
| --- | --- |
| Wallet SDK | [Tether WDK](https://docs.wdk.tether.io) `@tetherto/wdk-wallet-solana` (key derivation, signing, transfers) |
| Web app | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query |
| Solana libraries | `@solana/*` 3.0.3 (the version WDK is built on) |
| On-chain program | Rust, Anchor 1.1.2, `anchor-spl`, tested with LiteSVM |
| Backend | Hono on bun, `bun:sqlite`, Tether WDK for the server wallet |
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
│       │   ├── lib.rs          the fourteen instructions
│       │   ├── math.rs         pure pool and vesting arithmetic, unit-tested
│       │   ├── state.rs        Pool, ClaimLink and Timelock accounts
│       │   ├── constants.rs    seeds, fee limits
│       │   ├── error.rs        custom errors
│       │   └── instructions/   init_pool, liquidity, swap, claim_sol, claim_token, timelock, stealth
│       └── tests/              test_amm.rs (21), test_claim_links.rs (14), test_timelocks.rs (13), run in LiteSVM
├── web/                  React app (the wallet UI)
│   └── src/
│       ├── wallet/       WalletContext, WDK wrapper, vault crypto/storage, RPC helpers
│       ├── swap/         pool reserves and quoting, swap transaction builder
│       ├── links/        link secrets, on-chain link reads, create/cancel/claim builders
│       ├── locks/        lock schedules, on-chain lock reads, create/withdraw/cancel builders
│       ├── stealth/      paying a stealth address, scanning announcements, withdrawing
│       ├── nft/          Metaplex Core reads, mint and send builders, picture loading
│       ├── ui/           guilloche patterns, receipts, toasts (the design system)
│       ├── pages/        Onboarding, Unlock, Dashboard, Send, Swap, Links, Locks, Stealth, Nfts, MintNft, NftDetail, More, Claim, Receive, Activity, Settings
│       ├── components/   Layout, CopyButton
│       ├── lib/          number formatting, error translation, a ticking clock hook
│       ├── api.ts        client for the backend
│       ├── shims/        browser stand-in for a Node-only WDK dependency
│       └── config.ts     network, RPC URL, known tokens, explorer links
├── server/               Hono backend, one folder per feature
│   └── src/
│       ├── index.ts          composition root: builds the pieces and starts the server
│       ├── app.ts            mounts each feature's routes, CORS and error handling
│       ├── config.ts         settings from the environment
│       ├── features/         everything about one capability lives together
│       │   ├── faucet/          routes, SQLite store, tests
│       │   ├── relay/           routes, the policy of what the relayer will pay for, tests
│       │   ├── announcements/   routes, store, indexer that reads stealth announcements, tests
│       │   ├── nft/             routes, picture store, tests
│       │   └── prices/          routes, cached SOL/USD service, tests
│       ├── chain/            talking to Solana: the server wallet (WDK), RPC adapters, interfaces
│       └── shared/           used by several features: database, rate limiter, retry, client IP, test helpers
├── packages/             code shared by web, scripts and server
│   ├── shared/           AMM and vesting math, stealth-address cryptography, devnet addresses (devnet.json)
│   └── program-client/   typed client for the program: PDAs, instruction builders, decoders, raw-scalar signing
├── docs/screenshots/     every screen, desktop and phone width
├── scripts/              seed-devnet.ts, nft-smoke.ts, stress-backend.ts, e2e-wallet.ts
└── keys/                 git-ignored: the server wallet's seed phrase
```

### What is `packages/` for?

Several parts of the project need the same code: the web app, the seed script and the server all talk to our Anchor program. `packages/` holds that shared code so it exists once.

- **`shared`:** the AMM math ported to TypeScript (the UI uses it to quote trades; the program recomputes the same numbers on-chain) and `devnet.json`, the addresses of the program, tokens and pools. The tests check the same numbers as the Rust tests, so the UI quote and the on-chain result cannot drift apart.
- **`program-client`:** builds the program's instructions from the IDL, so account order and roles always match the program. It also derives addresses, decodes accounts, and builds the claim transactions the relayer pays for. It replaces what a code generator such as Codama would produce, because the generators target a newer `@solana/kit` than the 3.0.3 line WDK is built on.

Other folders import them by name (`@wallet/shared`, `@wallet/program-client`).

## The on-chain program

`wallet_program` is deployed on devnet at [`6rAZLb32wv86p3uhqQQCZpDxn4BYiFBX7tqPvw7HpD27`](https://explorer.solana.com/address/6rAZLb32wv86p3uhqQQCZpDxn4BYiFBX7tqPvw7HpD27?cluster=devnet).

### Swaps (a constant-product AMM)

Each pool holds two tokens and keeps `reserve_a × reserve_b` from shrinking, so the price moves as people trade.

| Instruction | What it does |
| --- | --- |
| `init_pool(fee_bps)` | Creates an empty pool for a pair of mints, its LP-token mint and its two vaults. |
| `add_liquidity(a, b, min_lp)` | Deposits the largest amounts in the pool's ratio that fit within `a` and `b`, and mints LP tokens. |
| `remove_liquidity(lp, min_a, min_b)` | Burns LP tokens and returns the matching share of both reserves. |
| `swap(amount_in, min_out, a_to_b)` | Trades an exact input for at least `min_out`. The 0.3% fee stays in the pool. |

- **Slippage protection is enforced on-chain**: every instruction takes a minimum-out argument and fails with `SlippageExceeded` rather than pay less.
- **Minimum liquidity**: the first deposit permanently locks 1,000 LP shares, which stops the "inflate the share price on an empty pool" attack.
- **Accounts are validated**: vaults must be the pool's own associated token accounts, and user accounts must belong to the signer.

### Claim links (escrow)

A link is backed by a `ClaimLink` account (a PDA seeded by the link's public key). SOL sits in that account's own lamports; tokens sit in a vault token account it owns.

| Instruction | What it does |
| --- | --- |
| `create_sol_link` / `create_token_link` `(amount, expiry)` | Escrows the funds and records the sender, the claim public key, the amount and the expiry. |
| `claim_sol_link` / `claim_token_link` | Pays the funds to a recipient, then closes the escrow. **Must be signed by the claim key**, i.e. by whoever holds the link's secret. The fee payer can be anyone. Fails after expiry. |
| `refund_sol_link` / `refund_token_link` | The sender cancels the link and gets everything back, expired or not. |

- **The recipient is bound into the signed transaction**, so nobody watching the network can swap in their own address and steal the claim.
- **Link types can't be mixed up**: using the SOL path on a token link would close the escrow and strand the tokens, so each path checks the link's type (`LinkTypeMismatch`).
- **Donations can't block a claim**: the claim pays out the vault's whole balance, so a stray token sent to the vault can't stop it from closing.
- **Minimum amount**: a SOL link must cover the rent of a new account (checked against the cluster's current rent), because the recipient may not have an account yet.
- **Cancelling is always allowed.** Expiry only ends the claiming window, so a sender is never locked out of their money.

### Locks (timelocks and vesting)

A `Timelock` account (a PDA seeded by sender, recipient and a caller-chosen seed) owns a vault token account holding the locked tokens.

| Instruction | What it does |
| --- | --- |
| `create_timelock(amount, start, cliff, end, cancellable, seed)` | Moves the tokens into the vault and records the schedule. Rejects schedules that are empty, backwards, or already over. |
| `withdraw_timelock` | The recipient takes `vested(now) − already withdrawn`. When everything is out, the accounts are closed. Fails with `NothingToWithdraw` if nothing is available yet. |
| `cancel_timelock` | Only if the lock was created cancellable, and only by the sender. Pays the recipient what they have earned, returns the rest to the sender and closes the accounts. |

- **Vesting is linear.** Before the cliff nothing is available; after it the amount grows evenly until the end. "Unlock on a date" is the special case where the cliff and the end are the same moment. The same formula lives in Rust (`math.rs`) and TypeScript (`packages/shared/src/vesting.ts`) so the UI shows what the program will pay.
- **Time comes from the chain's clock**, not from the browser, so it can't be faked. The tests warp the clock to check before, during and after every schedule.

### Stealth announcements

`announce(ephemeral, stealth, view_tag)` does nothing except emit a `StealthAnnouncement` event, a public note saying "a payment to `stealth` was made, here is the sender's one-time public key and a one-byte hint". It has no state and holds no funds; it exists so the backend can find payments by reading the program's logs instead of scanning every transaction on Solana.

Other design notes: classic SPL Token only (no Token-2022), and large accounts are boxed to stay under the Solana VM's 4 KB stack limit. The program is built for size (`opt-level = "s"`) so an upgrade fits in a modest devnet balance.

## The backend

| Endpoint | What it does |
| --- | --- |
| `GET /health` | Liveness, and the server wallet's address. |
| `GET /prices` | `{ solUsd, updatedAt, stale }`, from CoinGecko, cached for 60 seconds. Serves the last good price (marked stale) if a refresh fails. |
| `GET /faucet/info`, `POST /faucet {address}` | Mints the test tokens. One claim per address per 24 hours, at most 5 per IP per day, plus a per-minute limit. |
| `GET /relay/info`, `POST /relay {transaction}` | Co-signs and broadcasts a claim transaction as its fee payer. |
| `GET /announcements?after=<id>&limit=<n>` | The stealth announcements the indexer has found, oldest first, plus `latestId`. Rate limited. |

**The announcement indexer** reads the program's transaction history, parses `Program data:` log lines into announcements and stores them in SQLite. It remembers how far it got, so a restart resumes where it stopped, and it retries when the RPC answers "429 too many requests". Only history newer than `announcementsSince` in `devnet.json` (when the announcing program version was deployed) is read, which keeps the first run cheap. Everything it serves is already public on-chain; the backend learns nothing about who a payment is for, because the check is done in your browser with your private scan key.

**The relayer is the sensitive part.** A fee payer that signs whatever it's handed would be drained in minutes, so it accepts one narrow shape only: **one claim instruction of our program, optionally with creating the recipient's token account.** Anything else is refused: transfers, swaps, other programs, two claims, address lookup tables, or a transaction where the relayer's address appears as an account of the claim. Every other signer must already have signed, requests are rate limited per IP, and it stops accepting work when its balance runs low. The policy is covered by unit tests that build real signed transactions for each attack.

The server never sees a link's secret: the claim transaction is signed in the browser with it, and the server only adds its own fee signature.

## Getting started

### Prerequisites

- [bun](https://bun.sh) (on Windows, for `web/`, `server/`, `scripts/` and `packages/`)
- For the on-chain program: Rust, Anchor and the Solana CLI, installed in WSL

### Run everything

```bash
bun install
bun run --cwd scripts seed-devnet   # once: creates the test tokens/pools and the server wallet (see below)
bun run dev:server                  # http://localhost:3000
bun run dev:web                     # http://localhost:5173
```

Open http://localhost:5173, create a wallet, and press **Get SOL** (the public devnet faucet is rate-limited; if it refuses, use https://faucet.solana.com with your address) and **Get test tokens**. Then try **Swap** and **Links**.

The web app finds the backend at `http://localhost:3000`. Set `VITE_API_URL` in `web/.env` to change that, and `VITE_RPC_URL` to use your own devnet RPC endpoint. Server settings are in [`server/.env.example`](server/.env.example).

### Seed the devnet pools and the server wallet

```bash
bun run --cwd scripts seed-devnet
```

The first run creates `keys/admin-seed.txt` (git-ignored), prints the server wallet's address and asks you to fund it with about 2.5 devnet SOL (`solana transfer <address> 2.5`). Run it again and it creates the tokens and pools, then writes `packages/shared/src/devnet.json`. It is safe to re-run. The same wallet is the test tokens' mint authority and the relayer's fee payer, so keep a little SOL in it: each faucet claim costs about 0.003 SOL of token-account rent and each relayed claim about 0.00001 SOL.

### Build and test the Anchor program

The project lives on the Windows filesystem, so run the Rust tools through WSL and quote the path (it contains spaces). **Point Cargo's build directory at the WSL filesystem.** Compiling on `/mnt/c` is very slow (a first build took over 10 minutes there); on the native filesystem it takes about two minutes and incremental builds take seconds.

```bash
wsl -e bash -lc "export CARGO_TARGET_DIR=\$HOME/.cache/solana-wallet-target; cd '/mnt/c/Users/<you>/<path to>/Solana-Wallet/anchor' && anchor build && cargo test"
```

`anchor build` also regenerates the IDL at `$CARGO_TARGET_DIR/idl/wallet_program.json`; copy it to `anchor/idl/` and commit it whenever the program's interface changes.

Program keypairs are git-ignored. On a fresh clone, run `anchor keys sync` to generate a new program ID, then redeploy and re-run the seed script. With `CARGO_TARGET_DIR` set, `anchor build` may generate a stray keypair in that directory; deploy with the keypair whose address matches `declare_id!`:

```bash
solana program deploy $CARGO_TARGET_DIR/deploy/wallet_program.so --program-id <path to the matching keypair>
```

An upgrade must hold the whole new binary in a temporary buffer (refunded afterwards) and may need to extend the program's storage, so have roughly twice the binary's rent available.

### Tests and checks

```bash
bun test                 # 179 TypeScript tests across web, server, packages
bun run build:web        # type-check + production build
bun run --cwd web lint
```

The Rust side has 12 unit tests (pool and vesting arithmetic) and 48 LiteSVM integration tests (21 for swaps, 14 for claim links, 13 for locks and announcements), run with `cargo test` as above.

Everything was also verified end to end in a real browser against devnet, with each result cross-checked from the Solana CLI: SOL and token sends, swaps in every direction, the faucet, and claim links. That covers a SOL link and a token link claimed by a recipient with 0 SOL (the relayer paid the fee and opened the token account), a link that can't be claimed twice, a malformed link, and cancelling a link. Locks were verified the same way (token and SOL locks, early withdrawal refused, partial and final withdrawals, a cancel that froze the schedule at what the recipient had earned, accounts closed and nothing lost). Stealth was verified in the browser too: a SOL payment and a token payment to the wallet's own stealth address were found by the scan and swept to a fresh address, with the one-time address paying its own fee and ending at zero. NFTs were minted from a picture in the UI, viewed, sent to a second account and seen in its gallery. A stress pass covered the whole app (see below): it found and fixed a stale-form bug when switching accounts, a misleading empty state while stealth balances loaded, activity labels that called every program call a swap, and public-RPC rate-limit failures in the activity and stealth lists (now throttled and retried).

### Stress tests

```bash
bun run --cwd scripts stress-backend   # 35 checks: malformed input, rate limits, bursts, uploads, CORS (needs the server running)
bun run --cwd scripts nft-smoke        # mints an NFT on devnet, finds it by owner, sends it on
bun run --cwd scripts e2e-wallet       # makes a throwaway test wallet in keys/e2e-seed.txt
```

In development only, `http://localhost:5173/?e2eSeed=<phrase>` opens a throwaway wallet without the password screen (optionally `&e2eAccount=1`), so screens can be driven and photographed by scripts. It never touches the stored vault and is stripped from production builds.

## How stealth addresses work

The maths is Ed25519 (the curve Solana addresses live on), in `packages/shared/src/stealth.ts`.

1. **Your two keys.** From your seed the wallet derives a *spend* key `s` and a *scan* key `v` at paths `m/44'/501'/7777'/0'/0'` and `…/7777'/0'/1'`. Their public halves `S = s·G` and `V = v·G` together are your stealth address (`stealth:` + base58 of both).
2. **Paying.** The sender picks a random `r`, publishes `R = r·G`, and computes a shared secret `r·V`. The one-time address is `P = S + H(r·V)·G`, where `H` is a hash.
3. **Finding a payment.** You compute the same secret as `v·R` (equal to `r·V`, because `r·v·G` is the same point either way), so you get the same `P`. Nobody without `v` can. A one-byte **view tag** (part of the hash) lets you skip 255 out of 256 announcements without doing the full maths.
4. **Spending.** The private key of `P` is `p = s + H(v·R)`. It's a raw scalar rather than a normal seed, so `packages/program-client/src/scalarSigned.ts` signs with it directly; the signature verifies with the standard Ed25519 check, so the network sees an ordinary transaction.

Safety details covered by tests: a stealth address made of an all-zero or small-order point is rejected (it would be spendable by anyone), announcements with such ephemeral keys are ignored, and the sweep is checked to verify under the normal signature rules.

## Hosting it

| Piece | Where | Notes |
| --- | --- | --- |
| **On-chain program** | Solana **devnet** (already deployed) | Nothing to host: it lives on the network. Keep it on devnet for a demo. Mainnet needs an audit and real SOL for rent, so it is not recommended for this project. |
| **Frontend** (`web/`) | Vercel, Netlify or Cloudflare Pages (all free) | It builds to static files (`bun run build:web`, output `web/dist`). Add a rewrite of every path to `index.html` (the `/claim` link needs it). Set `VITE_API_URL` to the backend's address and `VITE_RPC_URL` to a devnet RPC with its own key (free tiers from Helius or QuickNode), because the public endpoint rate-limits. |
| **Backend** (`server/`) | Fly.io (steps below) or Railway, with a persistent volume | It needs a disk (SQLite database and the NFT pictures) and a long-running process, so serverless platforms and free tiers that sleep or wipe their disk are a poor fit. Mount a volume and point `DB_PATH` and `NFT_DIR` at it. Set `ADMIN_SEED` as a secret, `CORS_ORIGINS` to the frontend's address, `PUBLIC_URL` to the backend's own public HTTPS address, and `RPC_URL`. Keep the server wallet funded with a little devnet SOL. |

### Deploying the backend to Fly.io

The repo root has a `Dockerfile`, `.dockerignore` and `fly.toml` written for this monorepo (Bun runtime, whole repo as the build context, because the server imports `packages/*` and the IDL). Don't use the files Fly's "Launch" generates inside `server/`: they use Node and npm, which cannot install `workspace:*` packages, and they only see the `server/` folder.

```bash
fly volumes create wallet_data --region fra --size 1      # the persistent disk (once)
fly secrets set ADMIN_SEED="twelve words ..." CORS_ORIGINS="https://your-project.vercel.app"
fly deploy                                                # run from the repo root
```

`fly.toml` already sets `PORT`, `DB_PATH`, `NFT_DIR`, `PUBLIC_URL` and a `/health` check, keeps exactly one machine running (the SQLite file and rate limits assume one process), and mounts the volume at `/data`. Change `PUBLIC_URL` if your app name differs from `solana-wallet-backend`. If you deploy through Fly's GitHub integration instead of the CLI, leave the working directory as the repo root.

### Deploying the frontend to Vercel

`web/vercel.json` holds the build settings, the rewrite that makes `/claim` links work, and security and cache headers. In Vercel: **Add New Project**, import the repo, and set **Root Directory** to `web` (leave "Include source files outside of the Root Directory" on, the build installs the whole workspace). Then add two environment variables and deploy:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | `https://solana-wallet-backend.fly.dev` (your Fly address) |
| `VITE_RPC_URL` | your devnet RPC URL (restrict its key to your Vercel domain) |

After the first deploy, put the real Vercel address into the backend's `CORS_ORIGINS` (`fly secrets set CORS_ORIGINS=...`). CORS matches the exact address, so Vercel's per-branch preview URLs are refused by the backend; list them too, comma separated, if you want to test on previews.

### Production settings

Each half of the monorepo has its own template. Copy it, fill it in, and never commit the real file (`.env.production` is git-ignored; the `.example` templates are committed).

| File | Used by | Variables |
| --- | --- | --- |
| [`web/.env.production.example`](web/.env.production.example) | `vite build` (read automatically) | `VITE_API_URL` (the backend's HTTPS address), `VITE_RPC_URL` (your devnet RPC). Everything `VITE_` ends up in the public bundle, so never put a secret here. |
| [`server/.env.production.example`](server/.env.production.example) | the backend process (Bun loads it when `NODE_ENV=production`) | `ADMIN_SEED` (secret), `CORS_ORIGINS`, `PUBLIC_URL`, `DB_PATH`, `NFT_DIR`, optional `PORT` and `RPC_URL`. |

On a host such as Vercel or Railway you can skip the files and enter the same names in the dashboard, which is the safer place for `ADMIN_SEED`. The two files must agree with each other: the frontend's `VITE_API_URL` is the backend's `PUBLIC_URL`, and the backend's `CORS_ORIGINS` is the frontend's address.

Two things to know before going live: the backend's address is written into every NFT's on-chain link, so choose the final address before minting anything you want to keep; and browsers block an HTTPS site from calling an HTTP backend, so both must be HTTPS.

## How the wallet works

- **Your seed phrase is your wallet.** The 12 words are the master secret; every account and key is derived from them. The password only protects the copy stored in this browser. It cannot recover a lost phrase.
- **Keys never leave the browser.** Signing happens locally through WDK. The RPC node only sees signed transactions.
- **SPL token balances live in token accounts.** Sending a token to someone who has never held it creates their account first, and someone has to pay that rent deposit.
- **Success means confirmed.** WDK only broadcasts a transaction, so the app polls the network and reports success or the on-chain failure reason, translated with the program's own error messages.

### Notes for contributors

- **WDK in the browser.** WDK targets Node.js. Two small shims make it run in Vite: `web/src/polyfills.ts` provides the `Buffer` global, and `web/src/shims/sodium-universal.ts` replaces a native Node module that WDK uses only to zero key bytes. The alias is set in `web/vite.config.ts`.
- **Library versions.** WDK is built on `@solana/*` 3.0.3, so our own Solana code pins that version to keep transaction types compatible.
- **Never hard-code rent.** Rent-exempt minimums change between clusters and over time, so the app asks the RPC (`getMinimumBalanceForRentExemption`).
- **Keep the math in sync.** `packages/shared/src/amm.ts` mirrors `anchor/programs/wallet_program/src/math.rs`. Change both together; the tests use the same vectors.
- **The relay policy is a security boundary.** Any new instruction the relayer should pay for must be added to `server/src/features/relay/relay.policy.ts` deliberately, with a test that an abuse variant is still refused.

## Roadmap

1. **NFT gallery and minting (Phase 7).**
2. **Polish (Phase 8).**
3. **Later.** A liquidity page in the UI (the program already supports it) and multi-hop swap routing.

## Security notes

- Devnet only, with no real value at stake. Not audited; do not use it for real funds.
- The encrypted vault is only as strong as your password.
- Anyone who has your recovery phrase controls your funds, and anyone who has a claim link controls the funds behind it until it is claimed or cancelled. Your stealth keys come from the same phrase, so restoring the phrase restores your stealth payments too.
- Stealth payments made before the wallet's scan started (or before `announcementsSince`) won't be found, and the scan only knows what the backend has indexed.
- Program keypairs (`anchor/target/deploy/*-keypair.json`), the server wallet's seed (`keys/`), `server/data/` and `.env` files are git-ignored. Never commit them.

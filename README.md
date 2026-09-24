# Solana Wallet

A self-custodial crypto wallet for **Solana devnet**, built as a project for a Solana course. It holds SOL, SPL tokens and (soon) NFTs, and lets you **send**, **swap**, **send by link**, **lock funds until a date** and **receive privately** with stealth addresses. Swaps, links, locks and stealth announcements run on our own on-chain program written in Rust with Anchor.

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
| 6 | **Stealth addresses** and the announcement indexer | Done (see the verification note below) |
| 7 | NFT gallery + mint | Planned |
| 8 | Polish, docs | Planned |

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
│       ├── pages/        Onboarding, Unlock, Dashboard, Send, Swap, Links, Locks, Stealth, Claim, Receive, Activity, Settings
│       ├── components/   Layout, CopyButton
│       ├── lib/          number formatting, error translation, a ticking clock hook
│       ├── api.ts        client for the backend
│       ├── shims/        browser stand-in for a Node-only WDK dependency
│       └── config.ts     network, RPC URL, known tokens, explorer links
├── server/               Hono backend
│   └── src/
│       ├── app.ts            wires routes, CORS and error handling
│       ├── routes/           faucet.ts, relay.ts, announcements.ts
│       ├── relayPolicy.ts    what the relayer will and will not pay for
│       ├── announcements.ts  indexer that reads stealth announcements from program logs
│       ├── prices.ts         cached SOL/USD
│       ├── admin.ts          the server wallet (WDK) and chain adapters
│       ├── db.ts             SQLite: faucet history and the announcement index
│       └── retry.ts, rateLimit.ts, config.ts, types.ts, index.ts
├── packages/             code shared by web, scripts and server
│   ├── shared/           AMM and vesting math, stealth-address cryptography, devnet addresses (devnet.json)
│   └── program-client/   typed client for the program: PDAs, instruction builders, decoders, raw-scalar signing
├── scripts/              seed-devnet.ts: creates the test tokens and pools
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
bun test                 # 141 TypeScript tests across web, server, packages
bun run build:web        # type-check + production build
bun run --cwd web lint
```

The Rust side has 12 unit tests (pool and vesting arithmetic) and 48 LiteSVM integration tests (21 for swaps, 14 for claim links, 13 for locks and announcements), run with `cargo test` as above.

Everything was also verified end to end in a real browser against devnet, with each result cross-checked from the Solana CLI: SOL and token sends, swaps in every direction, the faucet, and claim links. That covers a SOL link and a token link claimed by a recipient with 0 SOL (the relayer paid the fee and opened the token account), a link that can't be claimed twice, a malformed link, and cancelling a link. Locks were verified the same way (token and SOL locks, early withdrawal refused, partial and final withdrawals, a cancel that froze the schedule at what the recipient had earned, accounts closed and nothing lost). For stealth, a private SOL payment to the wallet's own stealth address was published on-chain and served by `/announcements`; the indexer, the cryptography and the sweep transaction are unit-tested, but the in-browser scan-and-withdraw round trip and the token payment path have only been exercised by those tests so far.

## How stealth addresses work

The maths is Ed25519 (the curve Solana addresses live on), in `packages/shared/src/stealth.ts`.

1. **Your two keys.** From your seed the wallet derives a *spend* key `s` and a *scan* key `v` at paths `m/44'/501'/7777'/0'/0'` and `…/7777'/0'/1'`. Their public halves `S = s·G` and `V = v·G` together are your stealth address (`stealth:` + base58 of both).
2. **Paying.** The sender picks a random `r`, publishes `R = r·G`, and computes a shared secret `r·V`. The one-time address is `P = S + H(r·V)·G`, where `H` is a hash.
3. **Finding a payment.** You compute the same secret as `v·R` (equal to `r·V`, because `r·v·G` is the same point either way), so you get the same `P`. Nobody without `v` can. A one-byte **view tag** (part of the hash) lets you skip 255 out of 256 announcements without doing the full maths.
4. **Spending.** The private key of `P` is `p = s + H(v·R)`. It's a raw scalar rather than a normal seed, so `packages/program-client/src/scalarSigned.ts` signs with it directly; the signature verifies with the standard Ed25519 check, so the network sees an ordinary transaction.

Safety details covered by tests: a stealth address made of an all-zero or small-order point is rejected (it would be spendable by anyone), announcements with such ephemeral keys are ignored, and the sweep is checked to verify under the normal signature rules.

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
- **The relay policy is a security boundary.** Any new instruction the relayer should pay for must be added to `server/src/relayPolicy.ts` deliberately, with a test that an abuse variant is still refused.

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

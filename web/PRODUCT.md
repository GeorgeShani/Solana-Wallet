# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Crypto newcomers using a devnet-only demo wallet, primarily course reviewers and the student who built it. They mostly open it on a laptop and sometimes on a phone. They don't know crypto vocabulary (seed phrase, lamports, ATA, PDA, slippage), so every concept has to be explained in plain words at the moment it matters. Success is that a first-timer can create a wallet, get test money, send, swap and receive without help.

## Product Purpose

A self-custodial Solana wallet (Solana devnet only, free test tokens with no real value). It holds SOL, SPL tokens and NFTs and lets the user send, swap, pay by claim link, lock funds until a date, receive privately with stealth addresses, and mint and send NFTs. Keys are derived from a 12-word phrase, encrypted in the browser, and never leave it. Success means it is as easy to use as Phantom while showing off the course's on-chain features.

## Positioning

Unlike a generic wallet, it ships privacy and scheduling features as first-class, beginner-friendly actions: claim links that need no wallet to receive, time-locked and vesting transfers, and stealth addresses, all backed by our own Anchor program and explained honestly (including what they do not hide).

## Operating Context

Runs in the browser (Vite + React) against Solana devnet, with an optional Hono backend for the faucet, price feed, fee relayer, stealth-announcement indexer and NFT image/metadata hosting. The Rust/Anchor program is built and deployed from WSL. Layout is a Phantom-style focused app frame: a centered column of about 420px on desktop with bottom-tab navigation, filling the screen on a phone.

## Capabilities and Constraints

- Existing pages: Onboarding, Unlock, Dashboard (balances), Send, Swap, Links (claim links), Claim (public), Locks, Stealth, Receive, Activity, Settings.
- Phase 7: NFT gallery, detail view, mint (Metaplex Core, images and metadata hosted by our backend, gallery read straight from devnet with no API key) and send NFT.
- Phase 8: polish (readable error toasts, loading and confirmation states, explorer link on every transaction, visible Devnet badge, responsive layout, README).
- Devnet only; not audited; classic SPL Token only in our program. Terminology to use: "recovery phrase" (not "seed"), "network fee", "test tokens".
- The tech stack is fixed: React 19, Tailwind v4, TanStack Query, React Router, Tether WDK.

## Brand Commitments

Feel: a little blockchain-native and unique, with its own design language, while staying as approachable and easy to use as Phantom. No existing logo or brand assets. The product name is "Solana Wallet" (working name, open to change).

## Evidence on Hand

Real devnet data only: the test wallet, tUSDC/tBONK test tokens, three pools. No testimonials, users or benchmarks exist and none must be invented.

## Product Principles

1. One clear action per screen; the next step is always obvious to a beginner.
2. Explain crypto in plain words where it appears; never assume vocabulary.
3. Be honest about privacy and risk (what stealth addresses and claim links do and do not hide; devnet only).
4. Show every result with proof: confirmed state, explorer link, translated error.
5. Safety before cleverness: destructive or irreversible actions are confirmed and their consequences stated.

## Accessibility & Inclusion

Keyboard operable, visible focus, WCAG AA contrast, reduced-motion respected, usable at phone width and with large text; never rely on color alone for status.

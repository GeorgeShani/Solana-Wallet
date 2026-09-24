import { address, type Address } from '@solana/addresses'
import { signature } from '@solana/keys'
import { createSolanaRpc } from '@solana/rpc'
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers'
import { partiallySignTransaction } from '@solana/transactions'
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import {
  createAssociatedTokenAccountIdempotent,
  findAssociatedTokenAddress,
  mintTo,
  PROGRAM_ADDRESS,
  toTransactionMessage,
} from '@wallet/program-client'
import type { ProgramSource } from './announcements'
import type { Config } from './config'
import type { Chain, Minter, Relayer } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createChain(rpcUrl: string): Chain {
  const rpc = createSolanaRpc(rpcUrl)
  return {
    async sendTransaction(base64Wire) {
      return rpc
        .sendTransaction(base64Wire as Parameters<typeof rpc.sendTransaction>[0], {
          encoding: 'base64',
          preflightCommitment: 'confirmed',
        })
        .send()
    },
    async getBalance(a) {
      return (await rpc.getBalance(a, { commitment: 'confirmed' }).send()).value
    },
    async confirm(sig) {
      for (let i = 0; i < 60; i++) {
        const { value } = await rpc.getSignatureStatuses([signature(sig)]).send()
        const status = value[0]
        if (status?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`)
        if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return
        await sleep(1000)
      }
      throw new Error('Timed out waiting for confirmation')
    },
  }
}

/** Reads our program's transaction history over RPC (used to index stealth announcements). */
export function createProgramSource(rpcUrl: string): ProgramSource {
  const rpc = createSolanaRpc(rpcUrl)
  return {
    async listSignatures({ before, until, limit }) {
      const res = await rpc
        .getSignaturesForAddress(PROGRAM_ADDRESS, {
          limit,
          before: before ? signature(before) : undefined,
          until: until ? signature(until) : undefined,
          commitment: 'confirmed',
        })
        .send()
      return res.map((s) => ({
        signature: String(s.signature),
        err: s.err,
        blockTime: s.blockTime == null ? null : Number(s.blockTime),
      }))
    },
    async getLogs(sig) {
      const tx = await rpc
        .getTransaction(signature(sig), { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
        .send()
      return tx?.meta?.logMessages ? [...tx.meta.logMessages] : null
    },
  }
}

export interface ServerWallet {
  address: Address
  relayer: Relayer
  minter: Minter
  chain: Chain
  dispose(): void
}

/**
 * The server's own wallet, derived from ADMIN_SEED with Tether WDK (the same SDK the app uses).
 * It is the mint authority of the devnet test tokens and the relayer's fee payer. Devnet only:
 * it holds test SOL and controls nothing of value.
 */
export async function createServerWallet(config: Config): Promise<ServerWallet> {
  const manager = new WalletManagerSolana(config.adminSeed, { provider: config.rpcUrl, commitment: 'confirmed' })
  const account = await manager.getAccount(0)
  const adminAddress = address(await account.getAddress())
  const chain = createChain(config.rpcUrl)

  const privateKey = account.keyPair.privateKey
  if (!privateKey) throw new Error('The server wallet has no private key')
  const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKey)
  if (signer.address !== adminAddress) throw new Error('Server wallet key does not match its address')

  return {
    address: adminAddress,
    chain,
    relayer: {
      address: adminAddress,
      sign: (tx) => partiallySignTransaction([signer.keyPair], tx as Parameters<typeof partiallySignTransaction>[1]),
    },
    minter: {
      address: adminAddress,
      async mintTokens(recipient, drops) {
        const instructions = []
        for (const { mint, amount } of drops) {
          const ata = await findAssociatedTokenAddress(recipient, mint)
          instructions.push(
            createAssociatedTokenAccountIdempotent({ payer: adminAddress, ata, owner: recipient, mint }),
            mintTo({ mint, destination: ata, authority: adminAddress, amount }),
          )
        }
        const { hash } = await account.sendTransaction(toTransactionMessage(instructions))
        await chain.confirm(hash)
        return hash
      },
    },
    dispose() {
      account.dispose()
      manager.dispose()
    },
  }
}

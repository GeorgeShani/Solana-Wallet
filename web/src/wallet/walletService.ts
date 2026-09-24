import WalletManagerSolana, { type WalletAccountSolana } from '@tetherto/wdk-wallet-solana'
import type { Instruction } from '@solana/instructions'
import { toTransactionMessage } from '@wallet/program-client'
import { publicKeyToAddress, stealthKeysFromSeeds, type StealthKeys } from '@wallet/shared'
import { RPC_URL } from '../config'

/**
 * Dedicated derivation paths for the wallet's stealth (private-payment) keys. WDK prepends
 * m/44'/501'/ itself. Ordinary accounts use two segments (`{index}'/0'`), so these three-segment
 * paths can never collide with an account.
 */
const STEALTH_SPEND_PATH = "7777'/0'/0'"
const STEALTH_SCAN_PATH = "7777'/0'/1'"

/**
 * Thin wrapper over Tether WDK's Solana wallet. The seed phrase lives only in
 * WDK's memory while the wallet is unlocked; `dispose()` wipes derived keys.
 */
export class WalletService {
  private manager: WalletManagerSolana
  private accounts = new Map<number, WalletAccountSolana>()
  private stealth?: Promise<StealthKeys>

  constructor(seed: string) {
    this.manager = new WalletManagerSolana(seed, { provider: RPC_URL, commitment: 'confirmed' })
  }

  private async account(index: number): Promise<WalletAccountSolana> {
    let acct = this.accounts.get(index)
    if (!acct) {
      acct = await this.manager.getAccount(index)
      this.accounts.set(index, acct)
    }
    return acct
  }

  async getAddress(index: number): Promise<string> {
    return (await this.account(index)).getAddress()
  }

  async quoteSendSol(index: number, to: string, lamports: bigint): Promise<bigint> {
    const { fee } = await (await this.account(index)).quoteSendTransaction({ to, value: lamports })
    return fee
  }

  async sendSol(index: number, to: string, lamports: bigint) {
    return (await this.account(index)).sendTransaction({ to, value: lamports })
  }

  async quoteTransferToken(index: number, token: string, recipient: string, amount: bigint): Promise<bigint> {
    const { fee } = await (await this.account(index)).quoteTransfer({ token, recipient, amount })
    return fee
  }

  async transferToken(index: number, token: string, recipient: string, amount: bigint) {
    return (await this.account(index)).transfer({ token, recipient, amount })
  }

  /**
   * Sign and broadcast an arbitrary set of instructions with this account as fee payer.
   * Returns as soon as the network accepts it; call confirmSignature() to wait for the result.
   */
  async sendInstructions(index: number, instructions: Instruction[]) {
    return (await this.account(index)).sendTransaction(toTransactionMessage(instructions))
  }

  /**
   * The wallet's stealth keys (one identity per seed phrase, shared by all accounts), derived from
   * two WDK accounts at dedicated paths. Cached while the wallet is unlocked.
   */
  getStealthKeys(): Promise<StealthKeys> {
    this.stealth ??= (async () => {
      const seedAt = async (path: string) => {
        const account = await this.manager.getAccountByPath(path)
        const privateKey = account.keyPair.privateKey
        if (!privateKey) throw new Error('Could not derive the stealth keys')
        const seed = Uint8Array.from(privateKey) // copy before dispose() wipes the original
        const address = await account.getAddress()
        account.dispose()
        return { seed, address }
      }
      const [spend, scan] = [await seedAt(STEALTH_SPEND_PATH), await seedAt(STEALTH_SCAN_PATH)]
      const keys = stealthKeysFromSeeds(spend.seed, scan.seed)
      // Our curve maths must reproduce the public keys WDK itself derived, or something is wrong.
      if (publicKeyToAddress(keys.spendPub) !== spend.address || publicKeyToAddress(keys.scanPub) !== scan.address) {
        throw new Error('Stealth key derivation does not match the wallet keys')
      }
      return keys
    })()
    // don't cache a failure
    this.stealth.catch(() => (this.stealth = undefined))
    return this.stealth
  }

  dispose() {
    this.stealth = undefined
    for (const a of this.accounts.values()) a.dispose()
    this.accounts.clear()
    this.manager.dispose()
  }
}

import WalletManagerSolana, { type WalletAccountSolana } from '@tetherto/wdk-wallet-solana'
import type { Instruction } from '@solana/instructions'
import { toTransactionMessage } from '@wallet/program-client'
import { RPC_URL } from '../config'

/**
 * Thin wrapper over Tether WDK's Solana wallet. The seed phrase lives only in
 * WDK's memory while the wallet is unlocked; `dispose()` wipes derived keys.
 */
export class WalletService {
  private manager: WalletManagerSolana
  private accounts = new Map<number, WalletAccountSolana>()

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

  dispose() {
    for (const a of this.accounts.values()) a.dispose()
    this.accounts.clear()
    this.manager.dispose()
  }
}

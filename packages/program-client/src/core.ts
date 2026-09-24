import { address, getAddressDecoder, getProgramDerivedAddress, type Address } from '@solana/addresses'
import { AccountRole, type Instruction } from '@solana/instructions'
import idlJson from '../../../anchor/idl/wallet_program.json'
import { concat } from './encoding'
import { addressBytes, ASSOCIATED_TOKEN_PROGRAM, TOKEN_PROGRAM } from './token'

// ------------------------------------------------------------------ IDL

interface IdlAccount {
  name: string
  writable?: boolean
  signer?: boolean
  address?: string
}
interface IdlInstruction {
  name: string
  discriminator: number[]
  accounts: IdlAccount[]
}
export const idl = idlJson as unknown as {
  address: string
  instructions: IdlInstruction[]
  accounts: { name: string; discriminator: number[] }[]
  errors: { code: number; name: string; msg: string }[]
  events: { name: string; discriminator: number[] }[]
}

export const PROGRAM_ADDRESS = address(idl.address)

/** The program's own message for a custom error code (e.g. 6003 = slippage exceeded). */
export function describeProgramError(code: number): { name: string; message: string } | undefined {
  const e = idl.errors.find((x) => x.code === code)
  return e && { name: e.name, message: e.msg }
}

/** The 8-byte discriminator that starts every instruction's data (from the IDL). */
export function instructionDiscriminator(name: string): Uint8Array {
  return Uint8Array.from(idlInstruction(name).discriminator)
}

function idlInstruction(name: string): IdlInstruction {
  const ix = idl.instructions.find((i) => i.name === name)
  if (!ix) throw new Error(`Instruction ${name} not found in the IDL`)
  return ix
}

/** Build an instruction straight from the IDL, so account order and roles can't drift from the program. */
export function build(name: string, accounts: Record<string, Address>, args: Uint8Array): Instruction {
  const ix = idlInstruction(name)
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: ix.accounts.map((a) => {
      const addr = accounts[a.name] ?? (a.address ? address(a.address) : undefined)
      if (!addr) throw new Error(`${name}: missing account "${a.name}"`)
      const role = a.signer
        ? a.writable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : a.writable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY
      return { address: addr, role }
    }),
    data: concat(Uint8Array.from(ix.discriminator), args),
  }
}


export async function findAssociatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [addressBytes(owner), addressBytes(TOKEN_PROGRAM), addressBytes(mint)],
  })
  return ata
}

const addressDecoder = getAddressDecoder()
export function addressFromBytes(bytes: Uint8Array): Address {
  return addressDecoder.decode(bytes)
}


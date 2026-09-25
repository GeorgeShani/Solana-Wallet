import { QRCodeSVG } from 'qrcode.react'
import CopyButton from '../components/CopyButton'
import { CLUSTER } from '../config'
import { Band } from '../ui/Guilloche'
import { useWallet } from '../wallet/WalletContext'

/** The address in 4-character groups, the way a serial number is read out. */
const groups = (a: string) => a.match(/.{1,4}/g)?.join(' ') ?? a

export default function Receive() {
  const { address } = useWallet()
  if (!address) return null
  return (
    <div className="space-y-5">
      <section className="banknote rise text-center" aria-label="Your address">
        <Band seed={address} className="absolute inset-x-0 top-0 h-14 w-full text-plate/50" draw />
        <div className="relative px-6 pt-20 pb-5">
          {/* Solana Pay style URI so wallet apps that scan it pre-fill the recipient */}
          <div className="mx-auto w-fit rounded-[4px] bg-white p-3 ring-1 ring-plate/60">
            <QRCodeSVG value={`solana:${address}`} size={176} fgColor="#052a2d" />
          </div>
          <p className="serial mt-5 leading-relaxed break-words" data-testid="address">
            {groups(address)}
          </p>
          <div className="mt-4 flex justify-center">
            <CopyButton text={address} label="Copy address" />
          </div>
        </div>
      </section>
      <p className="text-sm text-muted">
        Share this address to get paid. It only works on Solana <b className="text-ink">{CLUSTER}</b>: send it test SOL and
        test tokens, nothing else.
      </p>
    </div>
  )
}

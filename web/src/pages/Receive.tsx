import { QRCodeSVG } from 'qrcode.react'
import CopyButton from '../components/CopyButton'
import { CLUSTER } from '../config'
import { useWallet } from '../wallet/WalletContext'

export default function Receive() {
  const { address } = useWallet()
  if (!address) return null
  return (
    <div className="card flex flex-col items-center gap-4 text-center">
      <h2 className="font-semibold">Receive</h2>
      <div className="rounded-2xl bg-white p-4">
        {/* Solana Pay style URI so wallet apps that scan it pre-fill the recipient */}
        <QRCodeSVG value={`solana:${address}`} size={190} />
      </div>
      <p className="break-all rounded-lg border border-line bg-ink px-3 py-2 font-mono text-xs">{address}</p>
      <CopyButton text={address} label="Copy address" />
      <p className="text-xs text-muted">
        This address only works on Solana <b className="text-white">{CLUSTER}</b>. Only send SOL and SPL tokens here.
      </p>
    </div>
  )
}

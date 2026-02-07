import { QRCodeSVG } from 'qrcode.react'

interface RaffleLinkProps {
  raffleId: string
}

export default function RaffleLink({ raffleId }: RaffleLinkProps) {
  const url =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/${raffleId}`
      : `/${raffleId}`

  return (
    <div className="flex flex-col items-center">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <QRCodeSVG value={url} size={256} level="L" className="mx-auto my-4" />
        <h3 className="text-lg font-semibold mb-2">{url}</h3>
      </a>
    </div>
  )
}

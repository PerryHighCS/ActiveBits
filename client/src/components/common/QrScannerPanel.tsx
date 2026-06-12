import { useMemo, useState } from 'react'
import { useZxing, type BarcodeFormat } from 'react-zxing'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import QrScannerPanelView from './QrScannerPanelView'
import type { ScannerErrorCode } from './qrScannerUtils'
import { buildQrScannerOptions } from './qrScannerPanelUtils'

export interface QrScannerPanelProps {
  errorMessage?: string
  formats?: BarcodeFormat[]
  onDetected?: (text: string) => void
  onError?: (code: ScannerErrorCode, error: unknown) => void
  onClose?: () => void
  timeBetweenDecodingAttempts?: number
  title?: string
}

export default function QrScannerPanel({
  errorMessage,
  formats,
  onDetected,
  onError,
  onClose,
  timeBetweenDecodingAttempts,
  title = 'Scan QR Code',
}: QrScannerPanelProps) {
  const [errorCode, setErrorCode] = useState<ScannerErrorCode | null>(null)
  const [hasDetected, setHasDetected] = useState(false)

  const constraints = useMemo(
    () => ({
      video: {
        facingMode: { ideal: 'environment' },
      },
    }),
    [],
  )

  const { ref } = useZxing(buildQrScannerOptions({
    constraints,
    formats,
    hasDetected,
    onDetected,
    onError,
    setErrorCode,
    setHasDetected,
    timeBetweenDecodingAttempts,
    wasmUrl: zxingReaderWasmUrl,
  }))

  return (
    <QrScannerPanelView
      errorCode={errorCode}
      errorMessage={errorMessage}
      onClose={onClose}
      title={title}
      videoRef={ref}
    />
  )
}

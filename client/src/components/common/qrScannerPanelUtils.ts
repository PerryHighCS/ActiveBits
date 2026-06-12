import { getQrScannerErrorCode, type ScannerErrorCode } from './qrScannerUtils'
import type { BarcodeFormat } from 'react-zxing'

interface QrScannerDecodeResult {
  rawValue?: string | null
}

interface BuildQrScannerOptionsArgs {
  constraints: MediaStreamConstraints
  formats?: BarcodeFormat[]
  hasDetected: boolean
  onDetected?: (text: string) => void
  onError?: (code: ScannerErrorCode, error: unknown) => void
  setErrorCode: (code: ScannerErrorCode) => void
  setHasDetected: (hasDetected: boolean) => void
  timeBetweenDecodingAttempts?: number
  wasmUrl: string
}

export function getQrScannerDetectedText(result: QrScannerDecodeResult): string | null {
  return result.rawValue || null
}

export function buildQrScannerOptions({
  constraints,
  formats,
  hasDetected,
  onDetected,
  onError,
  setErrorCode,
  setHasDetected,
  timeBetweenDecodingAttempts,
  wasmUrl,
}: BuildQrScannerOptionsArgs) {
  let detected = hasDetected
  return {
    paused: detected,
    constraints,
    formats,
    timeBetweenDecodingAttempts,
    wasmUrl,
    onDecodeResult: (result: QrScannerDecodeResult) => {
      if (detected) return
      const detectedText = getQrScannerDetectedText(result)
      if (!detectedText) return
      detected = true
      setHasDetected(true)
      onDetected?.(detectedText)
    },
    onError: (error: unknown) => {
      if (detected) return
      const errorCode = getQrScannerErrorCode(error)
      setErrorCode(errorCode)
      onError?.(errorCode, error)
    },
  }
}

import { getQrScannerErrorCode, type ScannerErrorCode } from './qrScannerUtils'

interface QrScannerDecodeResult {
  rawValue?: string | null
}

interface BuildQrScannerOptionsArgs {
  constraints: MediaStreamConstraints
  hasDetected: boolean
  onDetected?: (text: string) => void
  onError?: (error: unknown) => void
  setErrorCode: (code: ScannerErrorCode) => void
  setHasDetected: (hasDetected: boolean) => void
  wasmUrl: string
}

export function getQrScannerDetectedText(result: QrScannerDecodeResult): string | null {
  return result.rawValue || null
}

export function buildQrScannerOptions({
  constraints,
  hasDetected,
  onDetected,
  onError,
  setErrorCode,
  setHasDetected,
  wasmUrl,
}: BuildQrScannerOptionsArgs) {
  let detected = hasDetected
  return {
    paused: detected,
    constraints,
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
      setErrorCode(getQrScannerErrorCode(error))
      onError?.(error)
    },
  }
}

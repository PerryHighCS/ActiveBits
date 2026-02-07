export type ScannerErrorCode = 'camera-error' | 'scanner-error' | 'scanner-unavailable'

export function getQrScannerErrorCode(error: unknown): ScannerErrorCode {
  const errorName =
    typeof error === 'object' && error !== null && 'name' in error
      ? (error as { name?: string }).name
      : undefined

  if (errorName === 'NotAllowedError') {
    return 'camera-error'
  }
  if (errorName === 'NotFoundException') {
    return 'scanner-error'
  }
  return 'scanner-unavailable'
}

export function getQrScannerErrorMessage(errorCode: ScannerErrorCode | null | undefined): string {
  switch (errorCode) {
    case 'camera-error':
      return 'Unable to access the camera. Check permissions and try again.'
    case 'scanner-error':
      return 'Scanning failed. Please close and try again.'
    case 'scanner-unavailable':
    default:
      return 'In-page scanning is not supported on this browser. Use your camera app instead.'
  }
}

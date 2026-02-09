import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useZxing } from 'react-zxing'
import Button from '@src/components/ui/Button'
import { getQrScannerErrorCode, getQrScannerErrorMessage, type ScannerErrorCode } from './qrScannerUtils'

export interface QrScannerPanelProps {
  onDetected?: (text: string) => void
  onError?: (error: unknown) => void
  onClose?: () => void
}

export default function QrScannerPanel({ onDetected, onError, onClose }: QrScannerPanelProps) {
  const [errorCode, setErrorCode] = useState<ScannerErrorCode | null>(null)
  const [hasDetected, setHasDetected] = useState(false)
  const headingId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previouslyFocusedElement = useRef<HTMLElement | null>(null)

  const constraints = useMemo(
    () => ({
      video: {
        facingMode: { ideal: 'environment' },
      },
    }),
    [],
  )

  const { ref } = useZxing({
    paused: hasDetected,
    constraints,
    onDecodeResult: (result) => {
      if (result === null || result === undefined) return
      setHasDetected(true)
      onDetected?.(result.getText())
    },
    onError: (error) => {
      if (hasDetected) return
      setErrorCode(getQrScannerErrorCode(error))
      onError?.(error)
    },
  })

  useEffect(() => {
    previouslyFocusedElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    return () => {
      previouslyFocusedElement.current?.focus?.()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
      return
    }
    if (event.key !== 'Tab') return

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )

    if (!focusableElements || focusableElements.length === 0) {
      event.preventDefault()
      return
    }

    const focusableArray = Array.from(focusableElements)
    const first = focusableArray[0]
    const last = focusableArray[focusableArray.length - 1]
    const activeElement = document.activeElement

    if (event.shiftKey) {
      if (activeElement === first || !dialogRef.current?.contains(activeElement)) {
        event.preventDefault()
        last?.focus()
      }
    } else if (activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id={headingId} className="text-lg font-semibold">
            Scan QR Code
          </h2>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
        {!errorCode ? (
          <video
            ref={ref}
            className="w-full rounded-md"
            playsInline
            muted
            tabIndex={0}
          />
        ) : (
          <div
            className="rounded border border-dashed border-gray-300 p-6 text-center text-gray-600"
            tabIndex={0}
          >
            {getQrScannerErrorMessage(errorCode)}
          </div>
        )}
      </div>
    </div>
  )
}

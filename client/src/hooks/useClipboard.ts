import { useCallback, useEffect, useRef, useState } from 'react'

type ClipboardResetTimer = ReturnType<typeof setTimeout>

export interface ClipboardCopyDependencies {
  writeText: (text: string) => Promise<void>
  setCopiedText: (text: string | null) => void
  timeoutRef: { current: ClipboardResetTimer | null }
  resetDelay: number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  onError?: (error: unknown) => void
}

export async function copyTextWithReset(
  text: string | null | undefined,
  {
    writeText,
    setCopiedText,
    timeoutRef,
    resetDelay,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onError,
  }: ClipboardCopyDependencies,
): Promise<boolean> {
  if (!text) return false

  try {
    await writeText(text)
    setCopiedText(text)

    if (timeoutRef.current !== null) {
      clearTimeoutFn(timeoutRef.current)
    }

    timeoutRef.current = setTimeoutFn(() => {
      setCopiedText(null)
      timeoutRef.current = null
    }, resetDelay)

    return true
  } catch (error) {
    onError?.(error)
    return false
  }
}

export interface UseClipboardResult {
  copyToClipboard: (text: string | null | undefined) => Promise<boolean>
  copiedText: string | null
  isCopied: (text: string | null | undefined) => boolean
}

/**
 * Custom hook for copying text to clipboard with state management.
 */
export function useClipboard(resetDelay = 2000): UseClipboardResult {
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const timeoutRef = useRef<ClipboardResetTimer | null>(null)

  const copyToClipboard = useCallback(
    (text: string | null | undefined) =>
      copyTextWithReset(text, {
        writeText: (value) => navigator.clipboard.writeText(value),
        setCopiedText,
        timeoutRef,
        resetDelay,
        onError: (error) => {
          console.error('Failed to copy to clipboard:', error)
        },
      }),
    [resetDelay],
  )

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    },
    [],
  )

  return {
    copyToClipboard,
    copiedText,
    isCopied: (text) => copiedText === text,
  }
}

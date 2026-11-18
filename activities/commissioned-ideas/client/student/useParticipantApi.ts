import { useCallback, useState } from 'react'

/**
 * POST helper for participant-authenticated Commissioned Ideas routes. The server
 * identifies the student from the httpOnly participant cookie, which same-origin
 * requests send automatically; the client holds no credential.
 */
export function useParticipantApi(sessionId: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) {
          setError(data.error ?? 'Something went wrong. Please try again.')
          return false
        }
        return true
      } catch {
        setError('Network error — please try again.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [sessionId],
  )

  return { post, busy, error, clearError: () => setError(null) }
}

import { useCallback, useState } from 'react'

/**
 * POST helper for participant-authenticated Commissioned Ideas routes. The server
 * identifies the student from the httpOnly participant cookie, which same-origin
 * requests send automatically; the client holds no credential. Each request names
 * the participant this tab is bound to (`expectedParticipantId`).
 */
export function useParticipantApi(sessionId: string, expectedParticipantId: string | null) {
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
          // The participant this tab's socket is bound to; the server refuses the action if
          // the browser's cookie now belongs to someone else (another tab registered).
          body: JSON.stringify({ ...body, expectedParticipantId }),
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
    [sessionId, expectedParticipantId],
  )

  return { post, busy, error, clearError: () => setError(null) }
}

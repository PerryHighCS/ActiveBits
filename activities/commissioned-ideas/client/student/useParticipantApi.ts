import { useCallback, useState } from 'react'

/** POST helper for participant-authenticated Commissioned Ideas routes. */
export function useParticipantApi(sessionId: string, participantId: string, participantToken: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Commissioned-Ideas-Participant-Token': participantToken,
          },
          body: JSON.stringify({ ...body, participantId }),
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
    [sessionId, participantId, participantToken],
  )

  return { post, busy, error, clearError: () => setError(null) }
}

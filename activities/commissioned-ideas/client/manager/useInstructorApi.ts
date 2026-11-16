import { useCallback, useState } from 'react'

/** POST helper for instructor-authenticated Commissioned Ideas routes. */
export function useInstructorApi(sessionId: string, instructorPasscode: string) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const call = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Commissioned-Ideas-Instructor-Passcode': instructorPasscode,
          },
          body: JSON.stringify(body),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) {
          setError(data.error ?? 'Request failed. Please try again.')
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
    [sessionId, instructorPasscode],
  )

  return { call, busy, error, clearError: () => setError(null) }
}

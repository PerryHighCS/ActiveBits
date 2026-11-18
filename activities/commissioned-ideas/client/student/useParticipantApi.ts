import { useCallback, useState } from 'react'

/** Request status, tagged with the participant whose request it is. */
interface RequestStatus {
  forId: string | null
  busy: boolean
  error: string | null
}

/**
 * POST helper for participant-authenticated Commissioned Ideas routes. The server
 * identifies the student from the httpOnly participant cookie, which same-origin
 * requests send automatically; the client holds no credential. Each request names
 * the participant this tab is bound to (`expectedParticipantId`).
 *
 * Busy and error state belong to the participant that sent the request: if the tab's
 * participant changes, an earlier request's status is not shown to the new one.
 */
export function useParticipantApi(sessionId: string, expectedParticipantId: string | null) {
  const [status, setStatus] = useState<RequestStatus>({ forId: null, busy: false, error: null })
  const mine = status.forId === expectedParticipantId

  const postForResult = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      const forId = expectedParticipantId
      const settle = (error: string | null) =>
        setStatus((current) => (current.forId === forId ? { forId, busy: false, error } : current))
      setStatus({ forId, busy: true, error: null })
      try {
        const res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          // The participant this tab's socket is bound to; the server refuses the action if
          // the browser's cookie now belongs to someone else (another tab registered).
          body: JSON.stringify({ ...body, expectedParticipantId: forId }),
        })
        const data = (await res.json()) as Record<string, unknown>
        if (!res.ok) {
          settle(typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.')
          return null
        }
        settle(null)
        return data
      } catch {
        settle('Network error — please try again.')
        return null
      }
    },
    [sessionId, expectedParticipantId],
  )

  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => (await postForResult(path, body)) !== null,
    [postForResult],
  )

  return {
    post,
    postForResult,
    busy: mine && status.busy,
    error: mine ? status.error : null,
    clearError: () => setStatus((current) => ({ ...current, error: null })),
  }
}

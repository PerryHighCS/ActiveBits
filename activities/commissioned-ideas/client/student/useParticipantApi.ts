import { useCallback, useState } from 'react'
import { outcomeKindForStatus } from '../requestOutcome.js'

/** Request status, tagged with the participant whose request it is. */
interface RequestStatus {
  forId: string | null
  busy: boolean
  error: string | null
}

/**
 * What happened to a participant request (same meaning as the instructor's):
 * - `ok`: the server committed it (`data` is the parsed response body);
 * - `refused`: the server refused it (4xx), so nothing changed;
 * - `unknown`: no definite answer (network failure, a 5xx, or an unreadable success
 *   body), so the change may or may not have been committed; a snapshot will tell. The
 *   server answers 500 when a store error may have followed a commit.
 */
export type ParticipantApiOutcome =
  | { kind: 'ok'; data: Record<string, unknown> }
  | { kind: 'refused'; status: number }
  | { kind: 'unknown' }

const NETWORK_ERROR = 'Network error — please try again.'
const UNCONFIRMED_ERROR = 'The server could not confirm your change. Your view will update if it was saved.'

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

  const request = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<ParticipantApiOutcome> => {
      const forId = expectedParticipantId
      const settle = (error: string | null) =>
        setStatus((current) => (current.forId === forId ? { forId, busy: false, error } : current))
      setStatus({ forId, busy: true, error: null })
      let res: Response
      try {
        res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          // The participant this tab's socket is bound to; the server refuses the action if
          // the browser's cookie now belongs to someone else (another tab registered).
          body: JSON.stringify({ ...body, expectedParticipantId: forId }),
        })
      } catch {
        settle(NETWORK_ERROR)
        return { kind: 'unknown' }
      }
      const data = await res.json().then(
        (value: unknown) => (value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}),
        () => null,
      )
      if (outcomeKindForStatus(res.status) === 'unknown') {
        settle(UNCONFIRMED_ERROR)
        return { kind: 'unknown' }
      }
      if (outcomeKindForStatus(res.status) === 'refused') {
        settle(typeof data?.error === 'string' ? data.error : 'Something went wrong. Please try again.')
        return { kind: 'refused', status: res.status }
      }
      if (data === null) {
        settle(NETWORK_ERROR)
        return { kind: 'unknown' }
      }
      settle(null)
      return { kind: 'ok', data }
    },
    [sessionId, expectedParticipantId],
  )

  const postForResult = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      const outcome = await request(path, body)
      return outcome.kind === 'ok' ? outcome.data : null
    },
    [request],
  )

  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => (await request(path, body)).kind === 'ok',
    [request],
  )

  return {
    request,
    post,
    postForResult,
    busy: mine && status.busy,
    error: mine ? status.error : null,
    clearError: () => setStatus((current) => ({ ...current, error: null })),
  }
}

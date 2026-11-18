import { useCallback, useState } from 'react'

/**
 * What happened to an instructor request:
 * - `ok`: the server committed it (`data` is the parsed response body);
 * - `refused`: the server answered with an error status, so nothing changed;
 * - `unknown`: no readable answer (network failure, or an unreadable success body),
 *   so the change may or may not have been committed.
 */
export type InstructorApiOutcome =
  | { kind: 'ok'; data: Record<string, unknown> }
  | { kind: 'refused'; status: number }
  | { kind: 'unknown' }

/** POST helper for instructor-authenticated Commissioned Ideas routes. */
export function useInstructorApi(sessionId: string, instructorPasscode: string) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const request = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<InstructorApiOutcome> => {
      setBusy(true)
      setError(null)
      try {
        let res: Response
        try {
          res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Commissioned-Ideas-Instructor-Passcode': instructorPasscode,
            },
            body: JSON.stringify(body),
          })
        } catch {
          // The request may have reached the server; retrying blindly could repeat it
          // (for example, create a second new team).
          setError('Connection problem: the change may or may not have been saved. Check the board after it refreshes before trying again.')
          return { kind: 'unknown' }
        }
        const data = await res.json().then(
          (value: unknown) => (value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}),
          () => null,
        )
        if (!res.ok) {
          setError(typeof data?.error === 'string' ? data.error : 'Request failed. Please try again.')
          return { kind: 'refused', status: res.status }
        }
        if (data === null) {
          setError('The server did not confirm the change. The board will update when it catches up.')
          return { kind: 'unknown' }
        }
        return { kind: 'ok', data }
      } finally {
        setBusy(false)
      }
    },
    [sessionId, instructorPasscode],
  )

  const call = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => (await request(path, body)).kind === 'ok',
    [request],
  )

  return { call, request, busy, error, clearError: () => setError(null) }
}

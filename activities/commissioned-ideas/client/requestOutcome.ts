/**
 * What an HTTP status says about a Commissioned Ideas write (shared by the student and
 * instructor request hooks):
 * - `ok` (2xx): committed;
 * - `refused` (other 4xx and below-500 errors): the server checked and changed nothing;
 * - `unknown` (5xx): the server may have failed after the write committed (an ambiguous
 *   store error), so the client waits for a snapshot instead of assuming either way.
 * A network failure or an unreadable success body is also `unknown` (decided by the caller).
 */
export function outcomeKindForStatus(status: number): 'ok' | 'refused' | 'unknown' {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 500) return 'unknown'
  return 'refused'
}

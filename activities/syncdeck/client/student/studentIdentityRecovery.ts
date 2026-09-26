export interface SyncDeckRecoveredStudentIdentity {
  studentId: string
  studentName: string
}

type StudentIdentityFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'json'> & { status?: number }>

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildSyncDeckStudentIdentityApiUrl(sessionId: string): string {
  return `/api/syncdeck/${encodeURIComponent(sessionId)}/student-identity`
}

/**
 * Result of asking the server which student the accepted-entry cookie proves.
 * `denied` means the server answered that this browser has no accepted entry
 * (403); `unavailable` means the answer is unknown (network or server error).
 */
export type SyncDeckStudentIdentityLookup =
  | { status: 'ok'; identity: SyncDeckRecoveredStudentIdentity }
  | { status: 'denied' }
  | { status: 'unavailable' }

export async function lookupAcceptedSyncDeckStudentIdentity(
  sessionId: string,
  fetchImpl: StudentIdentityFetch | null = typeof fetch === 'function' ? fetch : null,
): Promise<SyncDeckStudentIdentityLookup> {
  if (!fetchImpl) return { status: 'unavailable' }
  // Call through a local binding: invoking native fetch as a method of another
  // object throws "Illegal invocation".
  const request = fetchImpl
  try {
    const response = await request(buildSyncDeckStudentIdentityApiUrl(sessionId), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
    if (!response.ok) {
      return response.status === 403 ? { status: 'denied' } : { status: 'unavailable' }
    }
    const payload = (await response.json()) as { studentId?: unknown; displayName?: unknown } | null
    const studentId = readTrimmedString(payload?.studentId)
    const studentName = readTrimmedString(payload?.displayName)
    return studentId ? { status: 'ok', identity: { studentId, studentName } } : { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}

/**
 * Reads the student proven by the parent's accepted-entry cookie. Returns null
 * when the server has no accepted entry for this browser or the request fails.
 */
export async function fetchAcceptedSyncDeckStudentIdentity(
  sessionId: string,
  fetchImpl: StudentIdentityFetch | null = typeof fetch === 'function' ? fetch : null,
): Promise<SyncDeckRecoveredStudentIdentity | null> {
  const lookup = await lookupAcceptedSyncDeckStudentIdentity(sessionId, fetchImpl)
  return lookup.status === 'ok' ? lookup.identity : null
}

/**
 * Reconciles a stored identity with the cookie-proven one on load. Browser
 * storage is only a cache: the cookie's student wins, a denied cookie clears
 * the cache, and an unknown answer keeps what is stored. Standalone
 * presentations open no student socket, so this is their only correction.
 */
export function reconcileStoredSyncDeckStudentIdentity(
  stored: SyncDeckRecoveredStudentIdentity | null,
  lookup: SyncDeckStudentIdentityLookup,
): { action: 'adopt'; identity: SyncDeckRecoveredStudentIdentity } | { action: 'keep' } | { action: 'clear' } {
  if (lookup.status === 'unavailable') {
    return stored ? { action: 'keep' } : { action: 'clear' }
  }
  if (lookup.status === 'denied') {
    return { action: 'clear' }
  }
  const { identity } = lookup
  if (identity.studentName) {
    return { action: 'adopt', identity }
  }
  // The cookie proves a student but has no display name: keep a stored
  // identity for that same student, otherwise the stale cache must go.
  return stored?.studentId === identity.studentId ? { action: 'keep' } : { action: 'clear' }
}

/**
 * Decides whether to adopt the server's identity. A missing identity or name
 * cannot resume, and an identity equal to the one the socket just rejected
 * would only be rejected again, so both require a fresh waiting-room entry.
 */
export function resolveRecoveredSyncDeckStudentIdentity(
  recovered: SyncDeckRecoveredStudentIdentity | null,
  rejectedStudentId: string | null,
): SyncDeckRecoveredStudentIdentity | null {
  if (!recovered || !recovered.studentId || !recovered.studentName) return null
  if (rejectedStudentId && recovered.studentId === rejectedStudentId) return null
  return recovered
}

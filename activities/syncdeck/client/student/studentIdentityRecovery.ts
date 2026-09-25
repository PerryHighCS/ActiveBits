export interface SyncDeckRecoveredStudentIdentity {
  studentId: string
  studentName: string
}

type StudentIdentityFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildSyncDeckStudentIdentityApiUrl(sessionId: string): string {
  return `/api/syncdeck/${encodeURIComponent(sessionId)}/student-identity`
}

/**
 * Reads the student proven by the parent's accepted-entry cookie. Returns null
 * when the server has no accepted entry for this browser or the request fails.
 */
export async function fetchAcceptedSyncDeckStudentIdentity(
  sessionId: string,
  fetchImpl: StudentIdentityFetch | null = typeof fetch === 'function' ? fetch : null,
): Promise<SyncDeckRecoveredStudentIdentity | null> {
  if (!fetchImpl) return null
  // Call through a local binding: invoking native fetch as a method of another
  // object throws "Illegal invocation".
  const request = fetchImpl
  try {
    const response = await request(buildSyncDeckStudentIdentityApiUrl(sessionId), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { studentId?: unknown; displayName?: unknown }
    const studentId = readTrimmedString(payload.studentId)
    const studentName = readTrimmedString(payload.displayName)
    return studentId ? { studentId, studentName } : null
  } catch {
    return null
  }
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

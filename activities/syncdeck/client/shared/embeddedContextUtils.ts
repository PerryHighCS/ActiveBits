export interface SyncDeckEmbeddedContextRequest {
  sessionId: string
  instructorPasscode?: string | null
  studentId?: string | null
}

export interface SyncDeckEmbeddedContextResponse {
  resolvedRole: 'teacher' | 'student'
  studentId?: string
  studentName?: string
}

export function buildSyncDeckEmbeddedContextApiUrl(sessionId: string): string {
  return `/api/syncdeck/${encodeURIComponent(sessionId)}/embedded-context`
}

export function buildSyncDeckEmbeddedContextRequestBody(
  request: SyncDeckEmbeddedContextRequest,
): Record<string, string> {
  const body: Record<string, string> = {}
  const instructorPasscode = request.instructorPasscode?.trim()
  const studentId = request.studentId?.trim()

  if (instructorPasscode) {
    body.instructorPasscode = instructorPasscode
  }

  if (studentId) {
    body.studentId = studentId
  }

  return body
}

export async function fetchSyncDeckEmbeddedContext(
  request: SyncDeckEmbeddedContextRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncDeckEmbeddedContextResponse | null> {
  const response = await fetchImpl(buildSyncDeckEmbeddedContextApiUrl(request.sessionId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(buildSyncDeckEmbeddedContextRequestBody(request)),
  })

  if (!response.ok) {
    return null
  }

  return response.json() as Promise<SyncDeckEmbeddedContextResponse>
}

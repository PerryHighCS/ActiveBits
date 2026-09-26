/**
 * Client side of SyncDeck's server-owned solo child launch. See "Solo child
 * binding" in `.agent/plans/shared-activity-runtime-authentication.md`.
 */

export interface SyncDeckSoloChildStartResult {
  childSessionId: string
  entryParticipantToken: string
}

/** Parses a solo overlay slide key (`"h:v"`) into the location the start route expects. */
export function parseSyncDeckSoloSlideLocation(slideKey: string): { h: number; v: number } | null {
  const match = /^(\d+):(\d+)$/.exec(slideKey)
  if (!match) {
    return null
  }
  return { h: Number(match[1]), v: Number(match[2]) }
}

/**
 * Asks the SyncDeck server to create (or reuse) this student's solo child and
 * returns its one-time entry handoff. The parent accepted-entry cookie is the
 * only identity the server trusts; `expectedStudentId` only guards against a
 * response for a different student.
 */
export async function startSyncDeckSoloChild(params: {
  fetchImpl: typeof fetch
  sessionId: string
  activityId: string
  location: { h: number; v: number }
  selectedOptions: Record<string, unknown>
  expectedStudentId: string
}): Promise<SyncDeckSoloChildStartResult> {
  // Call without a receiver: native fetch throws "Illegal invocation" when
  // invoked as a method of another object.
  const fetchImpl = params.fetchImpl
  const response = await fetchImpl(`/api/syncdeck/${encodeURIComponent(params.sessionId)}/solo-activity/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      activityId: params.activityId,
      location: params.location,
      activityOptions: params.selectedOptions,
    }),
  })
  if (!response.ok) {
    throw new Error(`Solo activity start was denied (${response.status})`)
  }
  const body = await response.json() as {
    childSessionId?: unknown
    entryParticipantToken?: unknown
    values?: { participantId?: unknown }
  }
  if (
    typeof body.childSessionId !== 'string'
    || body.childSessionId.length === 0
    || typeof body.entryParticipantToken !== 'string'
    || body.values?.participantId !== params.expectedStudentId
  ) {
    throw new Error('Solo activity start response was invalid')
  }
  return { childSessionId: body.childSessionId, entryParticipantToken: body.entryParticipantToken }
}

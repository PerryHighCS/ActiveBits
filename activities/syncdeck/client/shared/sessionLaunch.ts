interface SyncDeckCreateSessionResponse {
  id?: unknown
  instructorPasscode?: unknown
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export interface CreateConfiguredSyncDeckSessionParams {
  presentationUrl: string
  standaloneMode: boolean
  fetchFn?: typeof fetch
}

export interface CreateConfiguredSyncDeckSessionResult {
  sessionId: string
  instructorPasscode: string
}

async function bestEffortDeleteSyncDeckSession(params: {
  sessionId: string
  instructorPasscode: string
  fetchFn: typeof fetch
}): Promise<void> {
  try {
    await params.fetchFn(`/api/syncdeck/${encodeURIComponent(params.sessionId)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instructorPasscode: params.instructorPasscode,
      }),
    })
  } catch {
    // Best-effort cleanup only. Preserve the original create/configure failure.
  }
}

export async function createConfiguredSyncDeckSession(
  params: CreateConfiguredSyncDeckSessionParams,
): Promise<CreateConfiguredSyncDeckSessionResult> {
  const fetchFn = params.fetchFn ?? fetch

  const createResponse = await fetchFn('/api/syncdeck/create', {
    method: 'POST',
  })
  if (!createResponse.ok) {
    throw new Error(params.standaloneMode
      ? 'Unable to start solo mode right now.'
      : 'Unable to start a hosted SyncDeck session right now.')
  }

  const createPayload = (await createResponse.json()) as SyncDeckCreateSessionResponse
  const sessionId = readString(createPayload.id)
  const instructorPasscode = readString(createPayload.instructorPasscode)
  if (!sessionId || !instructorPasscode) {
    throw new Error(params.standaloneMode
      ? 'Unable to start solo mode right now.'
      : 'Unable to start a hosted SyncDeck session right now.')
  }

  const configureResponse = await fetchFn(`/api/syncdeck/${encodeURIComponent(sessionId)}/configure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      presentationUrl: params.presentationUrl,
      instructorPasscode,
      standaloneMode: params.standaloneMode,
    }),
  })
  if (!configureResponse.ok) {
    await bestEffortDeleteSyncDeckSession({
      sessionId,
      instructorPasscode,
      fetchFn,
    })
    throw new Error(params.standaloneMode
      ? 'Unable to load this presentation in solo mode right now.'
      : 'Unable to load this presentation in SyncDeck right now.')
  }

  return {
    sessionId,
    instructorPasscode,
  }
}

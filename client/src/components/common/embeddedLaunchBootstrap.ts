function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export interface EmbeddedLaunchBootstrapPayload {
  selectedOptions: Record<string, unknown> | null
}

export function readEmbeddedLaunchBootstrapPayload(payload: unknown): EmbeddedLaunchBootstrapPayload | null {
  if (!isObjectRecord(payload)) {
    return null
  }

  const embeddedLaunch = isObjectRecord(payload.embeddedLaunch)
    ? payload.embeddedLaunch
    : (() => {
      const session = isObjectRecord(payload.session) ? payload.session : null
      const data = isObjectRecord(session?.data) ? session.data : null
      return isObjectRecord(data?.embeddedLaunch) ? data.embeddedLaunch : null
    })()
  const selectedOptions = isObjectRecord(embeddedLaunch?.selectedOptions) ? embeddedLaunch.selectedOptions : null

  return {
    selectedOptions,
  }
}

export function readEmbeddedLaunchSelectedOptions(payload: unknown): Record<string, unknown> | null {
  return readEmbeddedLaunchBootstrapPayload(payload)?.selectedOptions ?? null
}

export async function fetchEmbeddedLaunchSelectedOptions(sessionId: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}/embedded-launch`)
  if (!response.ok) {
    return null
  }

  const payload = await response.json() as unknown
  return readEmbeddedLaunchSelectedOptions(payload)
}

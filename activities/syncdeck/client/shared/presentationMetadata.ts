interface RevealSyncEnvelope {
  type?: unknown
  action?: unknown
  payload?: unknown
}

interface RevealSyncMetadataPayload {
  title?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function parseRevealSyncEnvelope(data: unknown): RevealSyncEnvelope | null {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown
      return isPlainObject(parsed) ? (parsed as RevealSyncEnvelope) : null
    } catch {
      return null
    }
  }

  return isPlainObject(data) ? (data as RevealSyncEnvelope) : null
}

export function extractRevealMetadataTitle(data: unknown): string | null {
  const envelope = parseRevealSyncEnvelope(data)
  if (!envelope || envelope.type !== 'reveal-sync' || envelope.action !== 'metadata' || !isPlainObject(envelope.payload)) {
    return null
  }

  const payload = envelope.payload as RevealSyncMetadataPayload
  if (typeof payload.title !== 'string') {
    return null
  }

  const trimmedTitle = payload.title.trim()
  return trimmedTitle.length > 0 ? trimmedTitle : null
}

export function isRevealIframeReadySignal(data: unknown): boolean {
  const envelope = parseRevealSyncEnvelope(data)
  if (!envelope || envelope.type !== 'reveal-sync') {
    return false
  }

  return envelope.action === 'ready'
    || envelope.action === 'state'
    || envelope.action === 'storyboard'
    || envelope.action === 'overview'
    || envelope.action === 'overview-shown'
    || envelope.action === 'overview-hidden'
    || envelope.action === 'storyboard-shown'
    || envelope.action === 'storyboard-hidden'
    || envelope.action === 'paused'
    || envelope.action === 'resumed'
    || envelope.action === 'studentBoundaryChanged'
    || envelope.action === 'chalkboardState'
    || envelope.action === 'chalkboardStroke'
}

export function buildSyncDeckDocumentTitle(presentationTitle: string | null): string {
  if (presentationTitle == null || presentationTitle.trim().length === 0) {
    return 'ActiveBits'
  }

  return `${presentationTitle.trim()} | ActiveBits`
}

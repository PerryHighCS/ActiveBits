interface RevealSyncEnvelope {
  type?: unknown
  action?: unknown
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

export function shouldRelayRevealSyncPayloadToSession(payload: unknown): boolean {
  const envelope = parseRevealSyncEnvelope(payload)
  return !(envelope?.type === 'reveal-sync' && envelope.action === 'ready')
}

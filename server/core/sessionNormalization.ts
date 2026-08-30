type SessionNormalizer = (session: MutableSession) => void

interface MutableSession {
  type?: string
  data?: unknown
  [key: string]: unknown
}

const sessionNormalizers = new Map<string, SessionNormalizer>()

/**
 * Session-data keys owned by the shared runtime (capability + accepted-entry
 * auth state and the waiting-room handoff store). Activity normalizers that
 * rebuild `data` from an explicit key list must not be able to silently drop
 * these, so the framework re-attaches any that a normalizer did not carry
 * forward. A normalizer that keeps a key (even emptied) still wins.
 */
const PLATFORM_OWNED_SESSION_DATA_KEYS = [
  'activityCapabilities',
  'participantAuthTokens',
  'acceptedEntryParticipants',
  'entryParticipants',
] as const

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function registerSessionNormalizer(activityType: string, normalizer: SessionNormalizer): void {
  if (typeof activityType !== 'string' || activityType.length === 0) {
    throw new Error('registerSessionNormalizer requires a non-empty activity type string')
  }
  if (typeof normalizer !== 'function') {
    throw new Error(`registerSessionNormalizer for "${activityType}" requires a function`)
  }

  if (sessionNormalizers.has(activityType)) {
    if ((process.env.NODE_ENV || '').startsWith('dev')) {
      throw new Error(
        `[sessionNormalization] Attempted to override session normalizer for "${activityType}" in development mode`,
      )
    }
    console.warn(`[sessionNormalization] Overriding session normalizer for "${activityType}"`)
  }

  sessionNormalizers.set(activityType, normalizer)
}

export function getRegisteredSessionNormalizers(): Map<string, SessionNormalizer> {
  return new Map(sessionNormalizers)
}

export function normalizeSessionData<TSession>(session: TSession): TSession {
  if (session == null || typeof session !== 'object') {
    return session
  }

  const mutableSession = session as MutableSession
  mutableSession.data = ensurePlainObject(mutableSession.data)

  const dataBefore = mutableSession.data as Record<string, unknown>
  const preservedPlatformState: Record<string, unknown> = {}
  for (const key of PLATFORM_OWNED_SESSION_DATA_KEYS) {
    if (Object.hasOwn(dataBefore, key)) {
      preservedPlatformState[key] = dataBefore[key]
    }
  }

  const sessionType = mutableSession.type
  const normalizer = typeof sessionType === 'string' ? sessionNormalizers.get(sessionType) : undefined
  if (normalizer) {
    try {
      normalizer(mutableSession)
    } catch (err) {
      console.error(`[sessionNormalization] Failed to normalize session for "${sessionType}":`, err)
    }
  }

  const dataAfter = ensurePlainObject(mutableSession.data)
  for (const key of PLATFORM_OWNED_SESSION_DATA_KEYS) {
    if (Object.hasOwn(preservedPlatformState, key) && !Object.hasOwn(dataAfter, key)) {
      dataAfter[key] = preservedPlatformState[key]
    }
  }
  mutableSession.data = dataAfter

  return session
}

export function resetSessionNormalizersForTests(): void {
  sessionNormalizers.clear()
}

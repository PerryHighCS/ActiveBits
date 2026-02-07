type SessionNormalizer = (session: MutableSession) => void

interface MutableSession {
  type?: string
  data?: unknown
  [key: string]: unknown
}

const sessionNormalizers = new Map<string, SessionNormalizer>()

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
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
  if (!session || typeof session !== 'object') {
    return session
  }

  const mutableSession = session as MutableSession
  mutableSession.data = ensurePlainObject(mutableSession.data)

  const sessionType = mutableSession.type
  const normalizer = typeof sessionType === 'string' ? sessionNormalizers.get(sessionType) : undefined
  if (normalizer) {
    try {
      normalizer(mutableSession)
    } catch (err) {
      console.error(`[sessionNormalization] Failed to normalize session for "${sessionType}":`, err)
    }
  }

  return session
}

export function resetSessionNormalizersForTests(): void {
  sessionNormalizers.clear()
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { ValkeyPersistentStore } from './valkeyStore.js'

interface PersistentSession {
  activityName: string
  hashedTeacherCode: string | null
  createdAt: number
  sessionId: string | null
  teacherSocketId: string | null
  [key: string]: unknown
}

interface PersistentSessionStore {
  get(hash: string): Promise<PersistentSession | null>
  set(hash: string, data: PersistentSession): Promise<void>
  delete(hash: string): Promise<void>
  getAllHashes(): Promise<string[]>
  incrementAttempts(key: string): Promise<number>
  getAttempts(key: string): Promise<number>
}

type ValkeyStoreClient = ConstructorParameters<typeof ValkeyPersistentStore>[0]

interface PersistentSessionSocket {
  id?: string
  readyState: number
  send(payload: string): void
}

let persistentStore: PersistentSessionStore

const waitersByHash = new Map<string, PersistentSessionSocket[]>()

const MAX_ATTEMPTS = 5
const WAITER_TIMEOUT = 600_000
const CLEANUP_INTERVAL = 60_000

const HMAC_SECRET = process.env.PERSISTENT_SESSION_SECRET || 'default-secret-change-in-production'

function createInMemoryPersistentStore(): PersistentSessionStore {
  const memoryStore = new Map<string, unknown>()

  return {
    async get(hash: string): Promise<PersistentSession | null> {
      return (memoryStore.get(hash) as PersistentSession) || null
    },
    async set(hash: string, data: PersistentSession): Promise<void> {
      memoryStore.set(hash, data)
    },
    async delete(hash: string): Promise<void> {
      memoryStore.delete(hash)
    },
    async getAllHashes(): Promise<string[]> {
      return Array.from(memoryStore.keys()).filter((key) => !key.startsWith('rl:'))
    },
    async incrementAttempts(key: string): Promise<number> {
      const bucket = `rl:${key}`
      const current = (memoryStore.get(bucket) as number) || 0
      const next = current + 1
      memoryStore.set(bucket, next)
      setTimeout(() => {
        memoryStore.delete(bucket)
      }, 60_000)
      return next
    },
    async getAttempts(key: string): Promise<number> {
      return (memoryStore.get(`rl:${key}`) as number) || 0
    },
  }
}

/**
 * Initialize persistent session storage backend.
 */
export function initializePersistentStorage(valkeyClient: ValkeyStoreClient | null = null): void {
  if (valkeyClient) {
    console.log('Using Valkey for persistent session metadata')
    const valkeyStore = new ValkeyPersistentStore(valkeyClient)
    persistentStore = {
      async get(hash: string): Promise<PersistentSession | null> {
        return (await valkeyStore.get(hash)) as PersistentSession | null
      },
      async set(hash: string, data: PersistentSession): Promise<void> {
        await valkeyStore.set(hash, data)
      },
      async delete(hash: string): Promise<void> {
        await valkeyStore.delete(hash)
      },
      async getAllHashes(): Promise<string[]> {
        return await valkeyStore.getAllHashes()
      },
      async incrementAttempts(key: string): Promise<number> {
        return await valkeyStore.incrementAttempts(key)
      },
      async getAttempts(key: string): Promise<number> {
        return await valkeyStore.getAttempts(key)
      },
    }
  } else {
    console.log('Using in-memory storage for persistent session metadata')
    persistentStore = createInMemoryPersistentStore()
  }

  ensureCleanupTimer()
}

const weakSecrets = [
  'secret',
  'password',
  '12345',
  'changeme',
  'default',
  'admin',
  'letmein',
  'qwerty',
  'default-secret-change-in-production',
]

const envSecret = process.env.PERSISTENT_SESSION_SECRET
if (!envSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('⚠️  SECURITY WARNING: PERSISTENT_SESSION_SECRET is not set in production!')
    console.error('⚠️  Using default HMAC secret is a security risk.')
    console.error('⚠️  Set PERSISTENT_SESSION_SECRET environment variable immediately.')
  } else {
    console.warn('⚠️  Development mode: Using default HMAC secret. Set PERSISTENT_SESSION_SECRET for production.')
  }
} else {
  if (envSecret.length < 32) {
    console.warn(
      '⚠️  SECURITY WARNING: PERSISTENT_SESSION_SECRET is less than 32 characters. Use a longer, randomly generated secret for production.',
    )
  }
  if (weakSecrets.includes(envSecret.toLowerCase())) {
    console.warn(
      '⚠️  SECURITY WARNING: PERSISTENT_SESSION_SECRET appears to be a weak or default value. Choose a strong, unique secret.',
    )
  }
}

export function hashTeacherCode(teacherCode: string): string {
  return createHash('sha256').update(teacherCode).digest('hex')
}

export function generatePersistentHash(activityName: string, teacherCode: string): {
  hash: string
  activityName: string
  hashedTeacherCode: string
} {
  const hashedTeacherCode = hashTeacherCode(teacherCode)
  const salt = randomBytes(4).toString('hex')
  const payload = `${activityName}|${hashedTeacherCode}|${salt}`
  const hmac = createHmac('sha256', HMAC_SECRET).update(payload).digest('hex').substring(0, 12)

  return {
    hash: salt + hmac,
    activityName,
    hashedTeacherCode,
  }
}

export function verifyTeacherCodeWithHash(
  activityName: string,
  hash: string,
  teacherCode: string,
): { valid: boolean; error?: string } {
  if (hash.length !== 20) {
    const error = `Invalid link format (corrupted URL). Expected 20 characters, got ${hash.length}.`
    console.log(`Hash validation failed: ${error}`)
    return { valid: false, error }
  }

  const salt = hash.substring(0, 8)
  const expectedHmac = hash.substring(8)

  const hashedTeacherCode = hashTeacherCode(teacherCode)
  const payload = `${activityName}|${hashedTeacherCode}|${salt}`
  const computedHmac = createHmac('sha256', HMAC_SECRET).update(payload).digest('hex').substring(0, 12)

  const expectedBuffer = Buffer.from(expectedHmac, 'hex')
  const computedBuffer = Buffer.from(computedHmac, 'hex')

  try {
    if (!timingSafeEqual(expectedBuffer, computedBuffer)) {
      return { valid: false, error: 'Invalid teacher code' }
    }
  } catch {
    return { valid: false, error: 'Invalid teacher code' }
  }

  return { valid: true }
}

export async function getOrCreateActivePersistentSession(
  activityName: string,
  hash: string,
  hashedTeacherCode: string | null = null,
): Promise<PersistentSession> {
  let session = await persistentStore.get(hash)

  if (!session) {
    session = {
      activityName,
      hashedTeacherCode,
      createdAt: Date.now(),
      sessionId: null,
      teacherSocketId: null,
    }
    await persistentStore.set(hash, session)
    waitersByHash.set(hash, [])
    ensureCleanupTimer()
  } else if (!waitersByHash.has(hash)) {
    waitersByHash.set(hash, [])
  }

  if (hashedTeacherCode && !session.hashedTeacherCode) {
    session.hashedTeacherCode = hashedTeacherCode
    await persistentStore.set(hash, session)
  }

  return session
}

export async function getPersistentSession(hash: string): Promise<PersistentSession | null> {
  return await persistentStore.get(hash)
}

export function addWaiter(hash: string, ws: PersistentSessionSocket): number {
  let waiters = waitersByHash.get(hash)
  if (!waiters) {
    waiters = []
    waitersByHash.set(hash, waiters)
  }

  const filtered = waiters.filter((waiter) => waiter !== ws)
  filtered.push(ws)
  waitersByHash.set(hash, filtered)

  return filtered.length
}

export function removeWaiter(hash: string, ws: PersistentSessionSocket): boolean {
  const waiters = waitersByHash.get(hash)
  if (!waiters) return false

  const originalLength = waiters.length
  const filtered = waiters.filter((waiter) => waiter !== ws)
  waitersByHash.set(hash, filtered)

  return filtered.length < originalLength
}

export function getWaiterCount(hash: string): number {
  const waiters = waitersByHash.get(hash)
  return waiters ? waiters.length : 0
}

export function getWaiters(hash: string): PersistentSessionSocket[] {
  return waitersByHash.get(hash) || []
}

function broadcastToWaiters(hash: string, payload: Record<string, unknown>): void {
  const waiters = waitersByHash.get(hash)
  if (!waiters || waiters.length === 0) return

  const message = JSON.stringify(payload)
  for (const waiter of waiters) {
    if (waiter.readyState === 1) {
      try {
        waiter.send(message)
      } catch (err) {
        console.error('Failed to notify persistent session waiter:', err)
      }
    }
  }
}

export async function canAttemptTeacherCode(rateLimitKey: string): Promise<boolean> {
  const attempts = await persistentStore.getAttempts(rateLimitKey)
  return attempts < MAX_ATTEMPTS
}

export async function recordTeacherCodeAttempt(rateLimitKey: string): Promise<void> {
  await persistentStore.incrementAttempts(rateLimitKey)
}

export async function startPersistentSession(
  hash: string,
  sessionId: string,
  teacherWs: PersistentSessionSocket,
): Promise<PersistentSessionSocket[]> {
  const session = await persistentStore.get(hash)
  if (!session) return []

  session.sessionId = sessionId
  session.teacherSocketId = teacherWs.id || null
  await persistentStore.set(hash, session)

  const waiters = waitersByHash.get(hash) || []
  return [...waiters]
}

export async function isSessionStarted(hash: string): Promise<boolean> {
  const session = await persistentStore.get(hash)
  return session?.sessionId != null
}

export async function getSessionId(hash: string): Promise<string | null> {
  const session = await persistentStore.get(hash)
  return session?.sessionId ?? null
}

export async function resetPersistentSession(hash: string): Promise<void> {
  const session = await persistentStore.get(hash)
  if (session) {
    session.sessionId = null
    session.teacherSocketId = null
    await persistentStore.set(hash, session)
  }

  broadcastToWaiters(hash, { type: 'session-ended' })
}

export async function findHashBySessionId(sessionId: string): Promise<string | null> {
  const hashes = await persistentStore.getAllHashes()
  for (const hash of hashes) {
    const session = await persistentStore.get(hash)
    if (session?.sessionId === sessionId) {
      return hash
    }
  }
  return null
}

export async function cleanupPersistentSession(hash: string): Promise<void> {
  await persistentStore.delete(hash)
  waitersByHash.delete(hash)

  const hashes = await persistentStore.getAllHashes()
  if (hashes.length === 0 && cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

let cleanupTimer: NodeJS.Timeout | null = null

function ensureCleanupTimer(): void {
  if (cleanupTimer) return

  cleanupTimer = setInterval(() => {
    void (async () => {
      const now = Date.now()
      const hashes = await persistentStore.getAllHashes()

      for (const hash of hashes) {
        const session = await persistentStore.get(hash)
        const waiters = waitersByHash.get(hash) || []

        if (session && !session.sessionId && waiters.length === 0 && now - session.createdAt > WAITER_TIMEOUT) {
          await persistentStore.delete(hash)
          waitersByHash.delete(hash)
        }
      }

      const remaining = await persistentStore.getAllHashes()
      if (remaining.length === 0 && cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
    })()
  }, CLEANUP_INTERVAL)

  cleanupTimer.unref()
}

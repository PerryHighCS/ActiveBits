import Redis from 'ioredis'

export interface SessionLike {
  id: string
  lastActivity?: number
  [key: string]: unknown
}

interface BroadcastPayload {
  [key: string]: unknown
}

interface PersistentMetadata {
  waiters?: unknown[]
  [key: string]: unknown
}

type BroadcastHandler = (message: BroadcastPayload) => void

type ScanResult = [string, string[]]

interface RedisClient {
  on(event: 'message', handler: (channel: string, message: string) => void): void
  on(event: string, handler: (...args: unknown[]) => void): void
  subscribe(channel: string, callback?: (err: Error | null) => void): Promise<unknown>
  publish(channel: string, message: string): Promise<number>
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>
  del(key: string): Promise<number>
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  scan(cursor: string, ...args: Array<string | number>): Promise<unknown>
  quit(): Promise<unknown>
  ping(): Promise<string>
  dbsize(): Promise<number>
  pttl(key: string): Promise<number>
  call(command: string, ...args: string[]): Promise<string>
}

type RedisConstructor = new (url: string, options?: Record<string, unknown>) => RedisClient

/**
 * Valkey-based session store with Redis pub/sub for horizontal scaling.
 * Provides async session CRUD operations with automatic TTL management.
 */
export class ValkeySessionStore {
  public readonly ttlMs: number
  public readonly client: RedisClient
  private readonly subscriber: RedisClient
  private readonly broadcastHandlers: Map<string, BroadcastHandler[]>

  constructor(valkeyUrl: string, options: { ttlMs?: number } = {}) {
    const RedisCtor = Redis as unknown as RedisConstructor
    this.ttlMs = options.ttlMs || 60 * 60 * 1000
    this.client = new RedisCtor(valkeyUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    })

    this.subscriber = new RedisCtor(valkeyUrl)

    this.client.on('error', (err: unknown) => {
      console.error('Valkey client error:', err)
    })

    this.subscriber.on('error', (err: unknown) => {
      console.error('Valkey subscriber error:', err)
    })

    this.broadcastHandlers = new Map()
  }

  subscribeToBroadcast(channel: string, handler: BroadcastHandler): void {
    if (!this.broadcastHandlers.has(channel)) {
      this.broadcastHandlers.set(channel, [])
      this.subscriber.subscribe(channel, (err: Error | null) => {
        if (err) {
          console.error(`Failed to subscribe to ${channel}:`, err)
        }
      })
    }

    const handlers = this.broadcastHandlers.get(channel)
    if (handlers) {
      handlers.push(handler)
    }
  }

  initializePubSub(): void {
    this.subscriber.on('message', (channel: string, message: string) => {
      const handlers = this.broadcastHandlers.get(channel)
      if (!handlers) return

      try {
        const data = JSON.parse(message) as BroadcastPayload
        handlers.forEach((handler) => handler(data))
      } catch (err) {
        console.error(`Error handling message on ${channel}:`, err)
      }
    })
  }

  async publishBroadcast(channel: string, message: BroadcastPayload): Promise<void> {
    try {
      await this.client.publish(channel, JSON.stringify(message))
    } catch (err) {
      console.error(`Failed to publish to ${channel}:`, err)
    }
  }

  async get(id: string): Promise<SessionLike | null> {
    try {
      const data = await this.client.get(`session:${id}`)
      if (!data) return null
      return JSON.parse(data) as SessionLike
    } catch (err) {
      console.error(`Failed to get session ${id}:`, err)
      return null
    }
  }

  async set(id: string, session: SessionLike, ttlMs: number | null = null): Promise<void> {
    try {
      const ttl = ttlMs || this.ttlMs
      const data = JSON.stringify(session)
      await this.client.set(`session:${id}`, data, 'PX', ttl)
    } catch (err) {
      console.error(`Failed to set session ${id}:`, err)
      throw err
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.client.del(`session:${id}`)
      return result > 0
    } catch (err) {
      console.error(`Failed to delete session ${id}:`, err)
      return false
    }
  }

  async touch(id: string): Promise<boolean> {
    try {
      const script = `
                local key = KEYS[1]
                local ttl = ARGV[1]
                local data = redis.call('GET', key)
                if not data then
                    return 0
                end
                local session = cjson.decode(data)
                session.lastActivity = tonumber(ARGV[2])
                local updated = cjson.encode(session)
                redis.call('SET', key, updated, 'PX', ttl)
                return 1
            `

      const result = await this.client.eval(script, 1, `session:${id}`, this.ttlMs, Date.now())
      return result === 1
    } catch (err) {
      console.error(`Failed to touch session ${id}:`, err)
      return false
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = []
    let cursor = '0'

    do {
      const scanResult = (await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)) as unknown as ScanResult
      const [nextCursor, batch] = scanResult
      keys.push(...batch)
      cursor = nextCursor
    } while (cursor !== '0')

    return keys
  }

  async getAllIds(): Promise<string[]> {
    try {
      const keys = await this.scanKeys('session:*')
      return keys.map((key) => key.replace('session:', ''))
    } catch (err) {
      console.error('Failed to get all session IDs:', err)
      return []
    }
  }

  async getAll(): Promise<SessionLike[]> {
    try {
      const ids = await this.getAllIds()
      const sessions: SessionLike[] = []
      for (const id of ids) {
        const session = await this.get(id)
        if (session) {
          sessions.push(session)
        }
      }
      return sessions
    } catch (err) {
      console.error('Failed to get all sessions:', err)
      return []
    }
  }

  async cleanup(): Promise<void> {
    try {
      const now = Date.now()
      const sessions = await this.getAll()
      let cleaned = 0

      for (const session of sessions) {
        if (now - (session.lastActivity || 0) > this.ttlMs) {
          await this.delete(session.id)
          cleaned += 1
        }
      }

      if (cleaned > 0) {
        console.log(`Manual cleanup removed ${cleaned} expired sessions`)
      }
    } catch (err) {
      console.error('Failed to cleanup sessions:', err)
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.quit()
      await this.subscriber.quit()
    } catch (err) {
      console.error('Error closing Valkey connections:', err)
    }
  }
}

/**
 * Valkey-based persistent session metadata store.
 */
export class ValkeyPersistentStore {
  public readonly client: RedisClient
  public readonly ttlMs: number

  constructor(valkeyClient: RedisClient) {
    this.client = valkeyClient
    this.ttlMs = 24 * 60 * 60 * 1000
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = []
    let cursor = '0'

    do {
      const scanResult = (await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)) as unknown as ScanResult
      const [nextCursor, batch] = scanResult
      keys.push(...batch)
      cursor = nextCursor
    } while (cursor !== '0')

    return keys
  }

  async get(hash: string): Promise<PersistentMetadata | null> {
    try {
      const data = await this.client.get(`persistent:${hash}`)
      if (!data) return null
      return JSON.parse(data) as PersistentMetadata
    } catch (err) {
      console.error(`Failed to get persistent session ${hash}:`, err)
      return null
    }
  }

  async set(hash: string, metadata: PersistentMetadata): Promise<void> {
    try {
      const { waiters, ...storableData } = metadata
      void waiters
      const data = JSON.stringify(storableData)
      await this.client.set(`persistent:${hash}`, data, 'PX', this.ttlMs)
    } catch (err) {
      console.error(`Failed to set persistent session ${hash}:`, err)
      throw err
    }
  }

  async delete(hash: string): Promise<void> {
    try {
      await this.client.del(`persistent:${hash}`)
    } catch (err) {
      console.error(`Failed to delete persistent session ${hash}:`, err)
    }
  }

  async getAllHashes(): Promise<string[]> {
    try {
      const keys = await this.scanKeys('persistent:*')
      return keys.map((key) => key.replace('persistent:', ''))
    } catch (err) {
      console.error('Failed to get all persistent session hashes:', err)
      return []
    }
  }

  async incrementAttempts(key: string): Promise<number> {
    try {
      const script = `
                local value = redis.call('INCR', KEYS[1])
                if value == 1 then
                    redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return value
            `
      const ttlSeconds = 60
      const result = await this.client.eval(script, 1, `ratelimit:${key}`, ttlSeconds)
      if (typeof result === 'number') {
        return result
      }
      if (typeof result === 'string') {
        const parsed = parseInt(result, 10)
        return Number.isNaN(parsed) ? 0 : parsed
      }
      return 0
    } catch (err) {
      console.error(`Failed to increment attempts for ${key}:`, err)
      return 0
    }
  }

  async getAttempts(key: string): Promise<number> {
    try {
      const result = await this.client.get(`ratelimit:${key}`)
      if (!result) return 0
      const parsed = parseInt(result, 10)
      return Number.isNaN(parsed) ? 0 : parsed
    } catch (err) {
      console.error(`Failed to get attempts for ${key}:`, err)
      return 0
    }
  }
}

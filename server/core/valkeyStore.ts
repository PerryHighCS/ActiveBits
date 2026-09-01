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
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000
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
      void this.subscriber.subscribe(channel, (err: Error | null) => {
        if (err != null) {
          console.error(`Failed to subscribe to ${channel}:`, err)
        }
      })
    }

    const handlers = this.broadcastHandlers.get(channel)
    if (handlers != null) {
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
    // Non-throwing contract: delegate to getStrict and swallow a backend
    // failure to `null` for callers that tolerate it.
    try {
      return await this.getStrict(id)
    } catch {
      // getStrict already logged the structured failure.
      return null
    }
  }

  /**
   * Strict session read: a backend failure is logged and rethrown rather than
   * mapped to `null`. Capability-recovery routes use this so a transient Valkey
   * outage stays a retryable 500 instead of a false 404 the client treats as a
   * definitive "no such session".
   */
  async getStrict(id: string): Promise<SessionLike | null> {
    try {
      const data = await this.client.get(`session:${id}`)
      if (!data) return null
      return JSON.parse(data) as SessionLike
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.session-lookup-failed',
        sessionId: id,
        strict: true,
        error: err instanceof Error ? err.message : String(err),
      }))
      throw err
    }
  }

  async set(id: string, session: SessionLike, ttlMs: number | null = null): Promise<void> {
    try {
      const ttl = ttlMs ?? this.ttlMs
      const data = JSON.stringify(session)
      await this.client.set(`session:${id}`, data, 'PX', ttl)
    } catch (err) {
      console.error(`Failed to set session ${id}:`, err)
      throw err
    }
  }

  async consumeSessionDataToken(id: string, field: string, token: string): Promise<SessionLike | null> {
    // Non-throwing contract: delegate to the strict variant and swallow a
    // backend failure to `null` for callers that tolerate it.
    try {
      return await this.consumeSessionDataTokenStrict(id, field, token)
    } catch {
      // consumeSessionDataTokenStrict already logged the structured failure.
      return null
    }
  }

  /**
   * Strict variant: a backend failure is logged and rethrown rather than mapped
   * to `null`, which is indistinguishable from "token already consumed /
   * invalid". Callers that must keep a transient outage retryable (rather than
   * reporting it as a definitive 403) use this.
   */
  async consumeSessionDataTokenStrict(id: string, field: string, token: string): Promise<SessionLike | null> {
    try {
      const script = `
                local key = KEYS[1]
                local field = ARGV[1]
                local token = ARGV[2]
                local now = ARGV[3]
                local ttl = ARGV[4]
                local data = redis.call('GET', key)
                if not data then
                    return nil
                end
                local session = cjson.decode(data)
                if type(session.data) ~= 'table' then
                    return nil
                end
                local entry = session.data[field]
                if type(entry) ~= 'table' or entry.value ~= token then
                    return nil
                end
                if entry.expiresAt ~= nil then
                    local expiresAt = entry.expiresAt
                    if type(expiresAt) ~= 'number'
                        or expiresAt ~= expiresAt
                        or expiresAt == math.huge
                        or expiresAt == -math.huge
                        or expiresAt <= tonumber(now) then
                        return nil
                    end
                end
                session.data[field] = nil
                session.lastActivity = tonumber(now)
                local updated = cjson.encode(session)
                redis.call('SET', key, updated, 'PX', tonumber(ttl))
                return updated
            `
      const result = await this.client.eval(script, 1, `session:${id}`, field, token, Date.now(), this.ttlMs)
      return typeof result === 'string' ? JSON.parse(result) as SessionLike : null
    } catch (err) {
      console.error(JSON.stringify({
        activity: 'session-store',
        component: 'valkey-store',
        event: 'consume-session-data-token-failed',
        sessionId: id,
        field,
        strict: true,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      }))
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

  async refreshSessionExpiry(id: string, expectedExpiresAt: number, nextExpiresAt: number, ttlMs: number): Promise<SessionLike | null> {
    try {
      const script = `
        local data = redis.call('GET', KEYS[1])
        if not data then return nil end
        local session = cjson.decode(data)
        if type(session.data) ~= 'table' or session.data.expiresAt ~= tonumber(ARGV[1]) then return nil end
        session.data.expiresAt = tonumber(ARGV[2])
        session.lastActivity = tonumber(ARGV[3])
        local updated = cjson.encode(session)
        redis.call('SET', KEYS[1], updated, 'PX', tonumber(ARGV[4]))
        return updated
      `
      const result = await this.client.eval(script, 1, `session:${id}`, expectedExpiresAt, nextExpiresAt, Date.now(), ttlMs)
      return typeof result === 'string' ? JSON.parse(result) as SessionLike : null
    } catch (err) {
      console.error(JSON.stringify({ activity: 'session-store', component: 'valkey-store', event: 'refresh-session-expiry-failed', error: err instanceof Error ? { name: err.name, message: err.message } : String(err) }))
      return null
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
        if (session != null) {
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
        if (now - (session.lastActivity ?? 0) > this.ttlMs) {
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
    // Non-throwing contract: delegate the single read/parse path to getStrict
    // (which already logs the failure) and swallow a backend failure to `null`
    // for callers that tolerate it. `hash` is kept out of any format-string
    // position - it derives from a request-controlled session id.
    try {
      return await this.getStrict(hash)
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.persistent-session-record-lookup-degraded',
        hash,
        error: err instanceof Error ? err.message : String(err),
      }))
      return null
    }
  }

  /**
   * Strict record read: a backend failure is logged and rethrown rather than
   * mapped to `null`. {@link findIndexedHashBySessionId} uses this so a
   * transient Valkey outage propagates as a retryable error instead of looking
   * like a stale reverse index that then gets deleted. The single source of
   * truth for the `persistent:` key format and record decoding.
   */
  async getStrict(hash: string): Promise<PersistentMetadata | null> {
    try {
      const data = await this.client.get(`persistent:${hash}`)
      if (!data) return null
      return JSON.parse(data) as PersistentMetadata
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.persistent-session-record-lookup-failed',
        hash,
        strict: true,
        error: err instanceof Error ? err.message : String(err),
      }))
      throw err
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

  async getHashBySessionId(sessionId: string): Promise<string | null> {
    try {
      return await this.client.get(`persistent-session-by-session:${sessionId}`)
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.persistent-session-hash-lookup-failed',
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      }))
      return null
    }
  }

  /**
   * Strict reverse-index read: a backend failure is logged and rethrown rather
   * than mapped to `null`. Manager-capability recovery uses this so a transient
   * Valkey outage becomes a retryable 500 instead of a "no such persistent
   * session" 404/403 the client would treat as terminal.
   */
  async getHashBySessionIdStrict(sessionId: string): Promise<string | null> {
    try {
      return await this.client.get(`persistent-session-by-session:${sessionId}`)
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.persistent-session-hash-lookup-failed',
        sessionId,
        strict: true,
        error: err instanceof Error ? err.message : String(err),
      }))
      throw err
    }
  }

  async setHashBySessionId(sessionId: string, hash: string): Promise<void> {
    try {
      await this.client.set(`persistent-session-by-session:${sessionId}`, hash, 'PX', this.ttlMs)
    } catch (err) {
      // Rethrow: manager-capability recovery is index-only, so a persistent
      // session whose record was written but whose reverse index was not is
      // silently unrecoverable (recovery classifies it as missing). Failing the
      // write lets the caller retry / surface the error instead of publishing a
      // "successful" session without its required index. The record write
      // (`set`) already rethrows, so callers already handle a rejected persist.
      console.error(JSON.stringify({
        event: 'valkey.persistent-session-hash-write-failed',
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      }))
      throw err
    }
  }

  async deleteHashBySessionId(sessionId: string): Promise<void> {
    try {
      await this.client.del(`persistent-session-by-session:${sessionId}`)
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.persistent-session-hash-delete-failed',
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  /**
   * Atomic compare-and-clear for a failed start rollback: in one server-side
   * script, drop the failed attempt's own reverse-index entry, then reset the
   * persistent record's started state *only if it still points at
   * `expectedSessionId`*. A concurrent start that linked a newer session id
   * before this runs is therefore never clobbered - no read-modify-write TOCTOU
   * window. Returns true only when this call cleared the record. A backend
   * failure propagates (the caller logs and swallows it).
   */
  async compareAndClearSessionId(hash: string, expectedSessionId: string): Promise<boolean> {
    const script = `
      -- persistent-session-compare-and-clear
      redis.call('DEL', KEYS[2])
      local raw = redis.call('GET', KEYS[1])
      if not raw then
        return 0
      end
      local record = cjson.decode(raw)
      if record.sessionId ~= ARGV[1] then
        return 0
      end
      record.sessionId = cjson.null
      record.teacherSocketId = cjson.null
      redis.call('SET', KEYS[1], cjson.encode(record), 'PX', tonumber(ARGV[2]))
      return 1
    `
    const result = await this.client.eval(
      script,
      2,
      `persistent:${hash}`,
      `persistent-session-by-session:${expectedSessionId}`,
      expectedSessionId,
      this.ttlMs,
    )
    return result === 1 || result === '1'
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

  /**
   * Strict enumeration: a scan failure is logged and rethrown rather than
   * mapped to `[]` (indistinguishable from "no persistent sessions"). Callers
   * on a strict recovery path use this so a transient Valkey outage during the
   * legacy fallback scan surfaces as a retryable error, not a false "no such
   * session".
   */
  async getAllHashesStrict(): Promise<string[]> {
    try {
      const keys = await this.scanKeys('persistent:*')
      return keys.map((key) => key.replace('persistent:', ''))
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.persistent-session-hash-enumeration-failed',
        strict: true,
        error: err instanceof Error ? err.message : String(err),
      }))
      throw err
    }
  }

  // Kept in sync with TEACHER_CODE_ATTEMPT_WINDOW_SECONDS in
  // persistentSessions.ts (surfaced to clients as `Retry-After`).
  private static readonly RATE_LIMIT_TTL_SECONDS = 60
  private static readonly INCREMENT_ATTEMPTS_SCRIPT = `
                local value = redis.call('INCR', KEYS[1])
                if value == 1 then
                    redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return value
            `

  private async evalIncrementAttempts(key: string): Promise<number> {
    const result = await this.client.eval(
      ValkeyPersistentStore.INCREMENT_ATTEMPTS_SCRIPT,
      1,
      `ratelimit:${key}`,
      ValkeyPersistentStore.RATE_LIMIT_TTL_SECONDS,
    )
    if (typeof result === 'number') {
      return result
    }
    if (typeof result === 'string') {
      const parsed = parseInt(result, 10)
      return Number.isNaN(parsed) ? 0 : parsed
    }
    return 0
  }

  async incrementAttempts(key: string): Promise<number> {
    try {
      return await this.evalIncrementAttempts(key)
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.increment-attempts-degraded',
        key,
        error: err instanceof Error ? err.message : String(err),
      }))
      return 0
    }
  }

  /**
   * Like {@link incrementAttempts} but rethrows a backend failure instead of
   * failing open with `0`. Brute-force guards on pre-auth recovery endpoints
   * use this so a limiter outage becomes a retryable 5xx rather than a window
   * in which every guess counts as "allowed".
   */
  async incrementAttemptsStrict(key: string): Promise<number> {
    try {
      return await this.evalIncrementAttempts(key)
    } catch (err) {
      console.error(JSON.stringify({
        event: 'valkey.increment-attempts-failed',
        error: err instanceof Error ? err.message : String(err),
      }))
      throw err
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

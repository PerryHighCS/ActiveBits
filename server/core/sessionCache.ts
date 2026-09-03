interface CacheEntry<TSession extends MutableSession> {
  session: TSession
  timestamp: number
  dirty: boolean
}

interface MutableSession {
  lastActivity?: number
  [key: string]: unknown
}

interface SessionCacheOptions<TSession extends MutableSession = MutableSession> {
  maxSize?: number
  ttlMs?: number
  touchFn?: ((id: string) => Promise<void>) | null
  /**
   * Fast-accept predicate for `replaceStaleFill`: return `true` when `incoming`
   * is provably at least as new as `cached` by a comparison that does NOT rely
   * on node-local wall clocks (e.g. a monotonic revision within one session
   * incarnation). Returning `false` is not "reject" - it falls through to the
   * identity check (did anything write during the caller's await?). Omitted ->
   * identity check only.
   */
  supersedes?: (incoming: TSession, cached: TSession) => boolean
}

/**
 * In-memory LRU cache for session keepalive operations.
 * Reduces Valkey round-trips for high-frequency WebSocket touch() calls.
 */
export class SessionCache<TSession extends MutableSession = MutableSession> {
  private readonly maxSize: number
  private readonly ttlMs: number
  private readonly cache: Map<string, CacheEntry<TSession>>
  private readonly touchQueue: Set<string>
  private readonly touchFn: ((id: string) => Promise<void>) | null
  private readonly supersedes: ((incoming: TSession, cached: TSession) => boolean) | null
  private readonly flushInterval: NodeJS.Timeout

  constructor(options: SessionCacheOptions<TSession> = {}) {
    this.maxSize = options.maxSize ?? 1000
    this.ttlMs = options.ttlMs ?? 30_000
    this.cache = new Map()
    this.touchQueue = new Set()
    this.touchFn = typeof options.touchFn === 'function' ? options.touchFn : null
    this.supersedes = typeof options.supersedes === 'function' ? options.supersedes : null

    this.flushInterval = setInterval(() => {
      void this.flushTouches(this.touchFn)
    }, 5_000)

    this.flushInterval.unref?.()
  }

  /**
   * Get a session from cache or fallback to store.
   */
  async get(id: string, fetchFn: (id: string) => Promise<TSession | null>): Promise<TSession | null> {
    const cached = this.cache.get(id)

    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      this.markRecentlyUsed(id, cached)
      return cached.session
    }

    const seen = cached?.session ?? null
    const session = await fetchFn(id)

    if (session) {
      this.replaceStaleFill(id, session, seen)
    } else {
      this.cache.delete(id)
      this.touchQueue.delete(id)
    }

    return session
  }

  /**
   * Publish the result of an async fill (a cache-miss load, a strict read, a
   * CAS result, a finalizer). `seen` is the cached session object the caller
   * observed *before* its await (via `peek`), or `null` if it saw none.
   *
   * The write lands only when it cannot roll the cache back:
   *  - the cache is empty, or still holds exactly `seen` (nothing raced the
   *    caller's await), or
   *  - `supersedes(incoming, current)` proves the fill is at least as new by a
   *    clock-independent comparison.
   * Otherwise something newer (a commit, or a recreated incarnation the caller
   * did not read) arrived while the caller was awaiting, and it is kept.
   */
  replaceStaleFill(id: string, session: TSession, seen: TSession | null): void {
    const current = this.cache.get(id)?.session ?? null
    const unchanged = current === seen
    const provablyNewer = current != null && this.supersedes != null && this.supersedes(session, current)
    if (current == null || unchanged || provablyNewer) {
      this.set(id, session, false)
    }
  }

  /**
   * Read the cached session without touching LRU order, TTL, or touch state.
   * Returns a past-TTL entry too (unlike getFresh()); callers use this only to
   * capture the pre-await baseline for replaceStaleFill().
   */
  peek(id: string): TSession | null {
    return this.cache.get(id)?.session ?? null
  }

  /**
   * Set/update a session in cache.
   */
  set(id: string, session: TSession, dirty = true): void {
    if (!this.cache.has(id) && this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey != null) {
        this.cache.delete(oldestKey)
        this.touchQueue.delete(oldestKey)
      }
    }

    const entry: CacheEntry<TSession> = {
      session,
      timestamp: Date.now(),
      dirty,
    }

    if (this.cache.has(id)) {
      this.cache.delete(id)
    }
    this.cache.set(id, entry)

    if (dirty) {
      this.touchQueue.add(id)
    }
  }

  /**
   * Touch a session in cache only. Actual Valkey write is deferred until flush.
   */
  touch(id: string): void {
    const cached = this.cache.get(id)
    if (!cached) return

    cached.session.lastActivity = Date.now()
    cached.timestamp = Date.now()
    this.markRecentlyUsed(id, cached)
    this.touchQueue.add(id)
  }

  /**
   * Return a cached session only if its entry is still within the cache TTL.
   */
  getFresh(id: string): TSession | null {
    const cached = this.cache.get(id)
    if (!cached) {
      return null
    }

    if (Date.now() - cached.timestamp >= this.ttlMs) {
      this.cache.delete(id)
      this.touchQueue.delete(id)
      return null
    }

    this.markRecentlyUsed(id, cached)
    return cached.session
  }

  /**
   * Invalidate a session in cache.
   */
  invalidate(id: string): void {
    this.cache.delete(id)
    this.touchQueue.delete(id)
  }

  /**
   * Flush pending touch operations to Valkey.
   */
  async flushTouches(touchFn: ((id: string) => Promise<void>) | null = null): Promise<void> {
    if (!touchFn || this.touchQueue.size === 0) {
      this.touchQueue.clear()
      return
    }

    const toFlush = Array.from(this.touchQueue)
    this.touchQueue.clear()

    await Promise.allSettled(toFlush.map((id) => touchFn(id)))
  }

  /**
   * Force flush a specific session to Valkey immediately.
   */
  async flushOne(id: string, setFn: (id: string, session: TSession) => Promise<void>): Promise<void> {
    const cached = this.cache.get(id)
    if (cached?.session == null) return

    await setFn(id, cached.session)
    cached.dirty = false
    this.touchQueue.delete(id)
    this.markRecentlyUsed(id, cached)
  }

  /**
   * Clean up expired cache entries.
   */
  cleanup(): void {
    const now = Date.now()
    for (const [id, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.ttlMs) {
        this.cache.delete(id)
        this.touchQueue.delete(id)
      }
    }
  }

  /**
   * Clear all cache and pending flushes.
   */
  clear(): void {
    this.cache.clear()
    this.touchQueue.clear()
  }

  /**
   * Check if a session exists in cache.
   */
  has(id: string): boolean {
    return this.cache.has(id)
  }

  /**
   * Shutdown cache and clear interval.
   */
  async shutdown(touchFn: ((id: string) => Promise<void>) | null = null): Promise<void> {
    clearInterval(this.flushInterval)

    if (touchFn != null) {
      await this.flushTouches(touchFn)
    }

    this.clear()
  }

  private markRecentlyUsed(id: string, cached: CacheEntry<TSession>): void {
    if (!this.cache.has(id)) return
    this.cache.delete(id)
    this.cache.set(id, cached)
  }
}

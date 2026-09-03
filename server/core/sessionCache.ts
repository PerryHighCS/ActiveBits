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
  // Monotonic per-id write generation. Bumped on every set / invalidate / evict
  // / miss so an async fill can tell whether the slot it read was mutated,
  // emptied, or deleted while it was awaiting. Never decremented; pruned only
  // when the id also leaves the cache via capacity eviction or cleanup().
  private readonly generation: Map<string, number>
  private readonly flushInterval: NodeJS.Timeout

  constructor(options: SessionCacheOptions<TSession> = {}) {
    this.maxSize = options.maxSize ?? 1000
    this.ttlMs = options.ttlMs ?? 30_000
    this.cache = new Map()
    this.touchQueue = new Set()
    this.generation = new Map()
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

    const fillToken = this.beginFill(id)
    const session = await fetchFn(id)

    if (session) {
      this.replaceStaleFill(id, session, fillToken)
    } else {
      this.invalidate(id)
    }

    return session
  }

  /**
   * Capture the write generation for `id` immediately before an async fill's
   * await (after any invalidate the same operation performs). Pass the returned
   * token to `replaceStaleFill`.
   */
  beginFill(id: string): number {
    return this.generation.get(id) ?? 0
  }

  private bumpGeneration(id: string): void {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1)
  }

  /**
   * Publish the result of an async fill (a cache-miss load, a strict read, a
   * CAS result, a finalizer, a keepalive revalidation). `fillToken` is the value
   * `beginFill(id)` returned before the caller's await.
   *
   * If the generation is unchanged, nothing set / invalidated / deleted / evicted
   * the slot during the await, so the fill is published. If it moved, the slot
   * was touched: publish only when a same-incarnation `supersedes` still proves
   * the fill newer than whatever is cached now - never repopulate an emptied or
   * deleted slot, and never roll a newer entry back.
   */
  replaceStaleFill(id: string, session: TSession, fillToken: number): void {
    if ((this.generation.get(id) ?? 0) !== fillToken) {
      const current = this.cache.get(id)?.session ?? null
      if (current == null || this.supersedes == null || !this.supersedes(session, current)) {
        return
      }
    }
    this.set(id, session, false)
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
        this.generation.delete(oldestKey)
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
    this.bumpGeneration(id)

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
   * Invalidate a session in cache. Advances the write generation so an async
   * fill that read the now-removed value (e.g. a strict read racing a delete)
   * cannot repopulate the emptied slot when it completes.
   */
  invalidate(id: string): void {
    this.cache.delete(id)
    this.touchQueue.delete(id)
    this.bumpGeneration(id)
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
    // Bound the generation map: an id with no live cache entry has no in-flight
    // fill worth guarding after a full TTL has elapsed.
    for (const id of this.generation.keys()) {
      if (!this.cache.has(id)) this.generation.delete(id)
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

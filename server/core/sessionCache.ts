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
  // Per-id write generation, taken from a single cache-wide monotonic counter
  // (`writeSeq`) that advances on every fill claim, set, invalidate, eviction,
  // expiry, cleanup, and clear. An async fill claims the value for its id before
  // its await; if it differs afterwards, a newer fill or mutation won. The map may be
  // pruned freely (capacity eviction, cleanup) because a missing entry reads
  // back as the *current* `writeSeq` - always >= any token ever handed out - so
  // a stale fill for a since-pruned id can never collide back to its old token.
  private readonly generation: Map<string, number>
  private writeSeq: number
  private readonly flushInterval: NodeJS.Timeout

  constructor(options: SessionCacheOptions<TSession> = {}) {
    this.maxSize = options.maxSize ?? 1000
    this.ttlMs = options.ttlMs ?? 30_000
    this.cache = new Map()
    this.touchQueue = new Set()
    this.generation = new Map()
    this.writeSeq = 0
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
      this.invalidateStaleFill(id, fillToken)
    }

    return session
  }

  /**
   * Claim a fresh generation for an async fill immediately before its await
   * (after any invalidate the same operation performs). A later-started fill
   * claims another generation, so an earlier result cannot publish over it.
   * Pass the returned token to `replaceStaleFill`.
   */
  beginFill(id: string): number {
    this.bumpGeneration(id)
    return this.generation.get(id)!
  }

  private bumpGeneration(id: string): void {
    this.writeSeq += 1
    this.generation.set(id, this.writeSeq)
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
    if ((this.generation.get(id) ?? this.writeSeq) !== fillToken) {
      const current = this.cache.get(id)?.session ?? null
      if (current == null || this.supersedes == null || !this.supersedes(session, current)) {
        return
      }
      // This older fill is provably newer than the cached snapshot within the
      // same incarnation, but a later fill still owns this generation. Refresh
      // the entry without advancing the generation so that later fill can
      // publish a recreated incarnation when it completes.
      this.set(id, session, false, false)
      return
    }
    this.set(id, session, false)
  }

  /**
   * Complete a fill that authoritatively found no record. Just like a
   * successful fill, its absence is only publishable while this operation
   * still owns the slot: a set/CAS/newer fill during the await must survive.
   */
  invalidateStaleFill(id: string, fillToken: number): void {
    if ((this.generation.get(id) ?? this.writeSeq) !== fillToken) return
    this.invalidate(id)
  }

  /**
   * Set/update a session in cache.
   */
  set(id: string, session: TSession, dirty = true, advanceGeneration = true): void {
    if (!this.cache.has(id) && this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey != null) {
        this.cache.delete(oldestKey)
        this.touchQueue.delete(oldestKey)
        // An in-flight fill may have captured this entry's current token. Mark
        // the eviction before pruning its per-id marker so that fill cannot
        // repopulate the slot after the capacity removal.
        this.bumpGeneration(oldestKey)
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
    if (advanceGeneration) {
      this.bumpGeneration(id)
    }

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
      this.bumpGeneration(id)
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
        this.bumpGeneration(id)
      }
    }
    // Bound the generation map. Safe even mid-fill: a pruned id's generation
    // reads back as the current `writeSeq`, which is >= every token handed out,
    // so a still-running fill for it will see a mismatch and drop rather than
    // collide back onto its captured token.
    for (const id of this.generation.keys()) {
      if (!this.cache.has(id)) this.generation.delete(id)
    }
  }

  /**
   * Clear all cache and pending flushes.
   */
  clear(): void {
    // Clearing a cold cache also invalidates fills that have claimed a
    // generation but have not published an entry yet.
    this.writeSeq += 1
    this.generation.clear()
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

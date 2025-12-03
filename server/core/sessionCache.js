/**
 * In-memory LRU cache for session keepalive operations.
 * Reduces Valkey round-trips for high-frequency WebSocket touch() calls.
 */
export class SessionCache {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 1000;
        this.ttlMs = options.ttlMs || 30_000; // 30 seconds cache TTL
        this.cache = new Map(); // sessionId -> { session, timestamp, dirty }
        this.touchQueue = new Set(); // Sessions that need touch() written to Valkey
        this.touchFn = typeof options.touchFn === 'function' ? options.touchFn : null;
        
        // Periodic flush to Valkey
        this.flushInterval = setInterval(() => {
            this.flushTouches(this.touchFn);
        }, 5_000); // Flush every 5 seconds
        
        this.flushInterval.unref?.();
    }

    /**
     * Get a session from cache or fallback to store.
     * @param {string} id - Session ID
     * @param {Function} fetchFn - Async function to fetch from store if cache miss
     * @returns {Promise<Object|null>}
     */
    async get(id, fetchFn) {
        const cached = this.cache.get(id);
        
        // Cache hit and not expired
        if (cached && Date.now() - cached.timestamp < this.ttlMs) {
            this._markRecentlyUsed(id, cached);
            return cached.session;
        }
        
        // Cache miss or expired - fetch from store
        const session = await fetchFn(id);
        
        if (session) {
            this.set(id, session, false);
        } else {
            // Remove from cache if session no longer exists
            this.cache.delete(id);
            this.touchQueue.delete(id);
        }
        
        return session;
    }

    /**
     * Set/update a session in cache.
     * @param {string} id - Session ID
     * @param {Object} session - Session object
     * @param {boolean} dirty - Whether this is a write that needs to propagate to Valkey
     */
    set(id, session, dirty = true) {
        // Evict oldest if cache is full
        if (!this.cache.has(id) && this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            this.touchQueue.delete(oldestKey);
        }

        const entry = {
            session,
            timestamp: Date.now(),
            dirty
        };

        // If key exists, delete before re-inserting to update iteration order
        if (this.cache.has(id)) {
            this.cache.delete(id);
        }
        this.cache.set(id, entry);
        
        if (dirty) {
            this.touchQueue.add(id);
        }
    }

    /**
     * Touch a session (update lastActivity) in cache only.
     * Actual Valkey write is deferred until flush.
     * @param {string} id - Session ID
     */
    touch(id) {
        const cached = this.cache.get(id);
        if (cached) {
            cached.session.lastActivity = Date.now();
            cached.timestamp = Date.now();
            this._markRecentlyUsed(id, cached);
            this.touchQueue.add(id);
        }
    }

    /**
     * Invalidate a session in cache (on delete or external update).
     * @param {string} id - Session ID
     */
    invalidate(id) {
        this.cache.delete(id);
        this.touchQueue.delete(id);
    }

    /**
     * Flush pending touch() operations to Valkey.
     * @param {Function} touchFn - Async function(id) to write touch to Valkey
     */
    async flushTouches(touchFn = null) {
        if (!touchFn || this.touchQueue.size === 0) {
            this.touchQueue.clear();
            return;
        }
        
        const toFlush = Array.from(this.touchQueue);
        this.touchQueue.clear();
        
        // Batch flush to Valkey
        await Promise.allSettled(
            toFlush.map(id => touchFn(id))
        );
    }

    /**
     * Force flush a specific session to Valkey immediately.
     * Used for critical mutations that need immediate persistence.
     * @param {string} id - Session ID
     * @param {Function} setFn - Async function(id, session) to write to Valkey
     */
    async flushOne(id, setFn) {
        const cached = this.cache.get(id);
        if (cached?.session) {
            await setFn(id, cached.session);
            cached.dirty = false;
            this.touchQueue.delete(id);
            this._markRecentlyUsed(id, cached);
        }
    }

    /**
     * Clean up expired cache entries.
     */
    cleanup() {
        const now = Date.now();
        for (const [id, cached] of this.cache.entries()) {
            if (now - cached.timestamp > this.ttlMs) {
                this.cache.delete(id);
                this.touchQueue.delete(id);
            }
        }
    }

    /**
     * Clear all cache and pending flushes.
     */
    clear() {
        this.cache.clear();
        this.touchQueue.clear();
    }

    /**
     * Check if a session exists in cache.
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        return this.cache.has(id);
    }

    /**
     * Shutdown cache and clear interval.
     */
    async shutdown(touchFn = null) {
        clearInterval(this.flushInterval);
        
        // Final flush before shutdown
        if (touchFn) {
            await this.flushTouches(touchFn);
        }
        
        this.clear();
    }

    /**
     * Mark a cache entry as most recently used by re-inserting it.
     * @param {string} id
     * @param {object} cached
     * @private
     */
    _markRecentlyUsed(id, cached) {
        if (!this.cache.has(id)) return;
        this.cache.delete(id);
        this.cache.set(id, cached);
    }
}

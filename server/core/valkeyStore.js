import Redis from "ioredis";

/**
 * Valkey-based session store with Redis pub/sub for horizontal scaling.
 * Provides async session CRUD operations with automatic TTL management.
 */
export class ValkeySessionStore {
    constructor(valkeyUrl, options = {}) {
        this.ttlMs = options.ttlMs || 60 * 60 * 1000; // 1 hour default
        this.client = new Redis(valkeyUrl, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: false,
        });
        
        // Separate client for pub/sub (cannot share with regular commands)
        this.subscriber = new Redis(valkeyUrl);
        
        this.client.on('error', (err) => {
            console.error('Valkey client error:', err);
        });
        
        this.subscriber.on('error', (err) => {
            console.error('Valkey subscriber error:', err);
        });

        // Broadcast handlers for cross-instance communication
        this.broadcastHandlers = new Map();
    }

    /**
     * Subscribe to broadcast messages for a specific channel.
     * @param {string} channel - Channel name (e.g., 'session-ended', 'session:123:broadcast')
     * @param {Function} handler - Callback function(message)
     */
    subscribeToBroadcast(channel, handler) {
        if (!this.broadcastHandlers.has(channel)) {
            this.broadcastHandlers.set(channel, []);
            this.subscriber.subscribe(channel, (err) => {
                if (err) console.error(`Failed to subscribe to ${channel}:`, err);
            });
        }
        this.broadcastHandlers.get(channel).push(handler);
    }

    /**
     * Initialize pub/sub message handling.
     * Call this once during server startup.
     */
    initializePubSub() {
        this.subscriber.on('message', (channel, message) => {
            const handlers = this.broadcastHandlers.get(channel);
            if (handlers) {
                try {
                    const data = JSON.parse(message);
                    handlers.forEach(handler => handler(data));
                } catch (err) {
                    console.error(`Error handling message on ${channel}:`, err);
                }
            }
        });
    }

    /**
     * Publish a broadcast message to all instances.
     * @param {string} channel - Channel name
     * @param {Object} message - Message object to broadcast
     */
    async publishBroadcast(channel, message) {
        try {
            await this.client.publish(channel, JSON.stringify(message));
        } catch (err) {
            console.error(`Failed to publish to ${channel}:`, err);
        }
    }

    /**
     * Get a session by ID.
     * @param {string} id - Session ID
     * @returns {Promise<Object|null>} Session object or null if not found
     */
    async get(id) {
        try {
            const data = await this.client.get(`session:${id}`);
            if (!data) return null;
            const session = JSON.parse(data);
            return session;
        } catch (err) {
            console.error(`Failed to get session ${id}:`, err);
            return null;
        }
    }

    /**
     * Set/update a session.
     * @param {string} id - Session ID
     * @param {Object} session - Session object
     * @param {number} [ttlMs] - Optional custom TTL in milliseconds
     */
    async set(id, session, ttlMs = null) {
        try {
            const ttl = ttlMs || this.ttlMs;
            const data = JSON.stringify(session);
            await this.client.set(`session:${id}`, data, 'PX', ttl);
        } catch (err) {
            console.error(`Failed to set session ${id}:`, err);
            throw err;
        }
    }

    /**
     * Delete a session.
     * @param {string} id - Session ID
     * @returns {Promise<boolean>} True if deleted, false if not found
     */
    async delete(id) {
        try {
            const result = await this.client.del(`session:${id}`);
            return result > 0;
        } catch (err) {
            console.error(`Failed to delete session ${id}:`, err);
            return false;
        }
    }

    /**
     * Touch a session to update its lastActivity timestamp and extend TTL.
     * @param {string} id - Session ID
     * @returns {Promise<boolean>} True if touched, false if session not found
     */
    async touch(id) {
        try {
            // Use Lua script for atomic read-modify-write
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
            `;
            
            const result = await this.client.eval(
                script,
                1,
                `session:${id}`,
                this.ttlMs,
                Date.now()
            );
            
            return result === 1;
        } catch (err) {
            console.error(`Failed to touch session ${id}:`, err);
            return false;
        }
    }

    /**
     * Helper to scan keys with a given pattern.
     * @param {string} pattern
     * @returns {Promise<string[]>}
     * @private
     */
    async _scanKeys(pattern) {
        const keys = [];
        let cursor = '0';
        do {
            const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            keys.push(...batch);
            cursor = nextCursor;
        } while (cursor !== '0');
        return keys;
    }

    /**
     * Get all session IDs (for cleanup/iteration).
     * Use sparingly - expensive operation.
     * @returns {Promise<string[]>} Array of session IDs
     */
    async getAllIds() {
        try {
            const keys = await this._scanKeys('session:*');
            return keys.map(key => key.replace('session:', ''));
        } catch (err) {
            console.error('Failed to get all session IDs:', err);
            return [];
        }
    }

    /**
     * Get all sessions (for cleanup/iteration).
     * Use sparingly - expensive operation.
     * @returns {Promise<Object[]>} Array of session objects
     */
    async getAll() {
        try {
            const ids = await this.getAllIds();
            const sessions = [];
            for (const id of ids) {
                const session = await this.get(id);
                if (session) sessions.push(session);
            }
            return sessions;
        } catch (err) {
            console.error('Failed to get all sessions:', err);
            return [];
        }
    }

    /**
     * Cleanup expired sessions (manual trigger, not typically needed with TTL).
     * Valkey handles TTL automatically, but this allows manual cleanup.
     */
    async cleanup() {
        // With Valkey TTL, this is mostly a no-op
        // But we can check for sessions past their expected lifetime
        try {
            const now = Date.now();
            const sessions = await this.getAll();
            let cleaned = 0;
            
            for (const session of sessions) {
                if (now - (session.lastActivity || 0) > this.ttlMs) {
                    await this.delete(session.id);
                    cleaned++;
                }
            }
            
            if (cleaned > 0) {
                console.log(`Manual cleanup removed ${cleaned} expired sessions`);
            }
        } catch (err) {
            console.error('Failed to cleanup sessions:', err);
        }
    }

    /**
     * Close connections gracefully.
     */
    async close() {
        try {
            await this.client.quit();
            await this.subscriber.quit();
        } catch (err) {
            console.error('Error closing Valkey connections:', err);
        }
    }
}

/**
 * Valkey-based persistent session metadata store.
 */
export class ValkeyPersistentStore {
    constructor(valkeyClient) {
        this.client = valkeyClient;
        this.ttlMs = 10 * 60 * 1000; // 10 minutes for persistent metadata
    }

    /**
     * Get persistent session metadata by hash.
     * @param {string} hash - Persistent session hash
     * @returns {Promise<Object|null>}
     */
    async get(hash) {
        try {
            const data = await this.client.get(`persistent:${hash}`);
            if (!data) return null;
            return JSON.parse(data);
        } catch (err) {
            console.error(`Failed to get persistent session ${hash}:`, err);
            return null;
        }
    }

    /**
     * Set persistent session metadata.
     * @param {string} hash - Persistent session hash
     * @param {Object} metadata - Metadata object (without waiters WebSocket array)
     */
    async set(hash, metadata) {
        try {
            // Don't store WebSocket connections - those are instance-specific
            const { waiters, ...storableData } = metadata;
            const data = JSON.stringify(storableData);
            await this.client.set(`persistent:${hash}`, data, 'PX', this.ttlMs);
        } catch (err) {
            console.error(`Failed to set persistent session ${hash}:`, err);
            throw err;
        }
    }

    /**
     * Delete persistent session metadata.
     * @param {string} hash - Persistent session hash
     */
    async delete(hash) {
        try {
            await this.client.del(`persistent:${hash}`);
        } catch (err) {
            console.error(`Failed to delete persistent session ${hash}:`, err);
        }
    }

    /**
     * Get all persistent session hashes.
     * @returns {Promise<string[]>}
     */
    async getAllHashes() {
        try {
            const keys = await this._scanKeys('persistent:*');
            return keys.map(key => key.replace('persistent:', ''));
        } catch (err) {
            console.error('Failed to get all persistent session hashes:', err);
            return [];
        }
    }

    /**
     * Rate limiting: increment attempt counter.
     * @param {string} key - Rate limit key (e.g., 'ip:hash')
     * @returns {Promise<number>} Current attempt count
     */
    async incrementAttempts(key) {
        try {
            const script = `
                local value = redis.call('INCR', KEYS[1])
                if value == 1 then
                    redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return value
            `;
            const ttlSeconds = 60;
            const result = await this.client.eval(
                script,
                1,
                `ratelimit:${key}`,
                ttlSeconds
            );
            return typeof result === 'number' ? result : parseInt(result, 10) || 0;
        } catch (err) {
            console.error(`Failed to increment attempts for ${key}:`, err);
            return 0;
        }
    }

    /**
     * Rate limiting: get attempt count.
     * @param {string} key - Rate limit key
     * @returns {Promise<number>}
     */
    async getAttempts(key) {
        try {
            const result = await this.client.get(`ratelimit:${key}`);
            return result ? parseInt(result, 10) : 0;
        } catch (err) {
            console.error(`Failed to get attempts for ${key}:`, err);
            return 0;
        }
    }
}

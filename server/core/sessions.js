import { randomBytes } from "crypto";
import { findHashBySessionId, resetPersistentSession } from "./persistentSessions.js";
import { ValkeySessionStore } from "./valkeyStore.js";
import { SessionCache } from "./sessionCache.js";

/**
 * In-memory session store with automatic TTL cleanup (for development/fallback).
 */
function normalizeSessionData(session) {
    if (!session || typeof session !== 'object') return session;
    session.data ??= {};
    // Initialize common fields
    session.type ??= session.type; // no-op, placeholder for future

    // Activity-specific defaults
    switch (session.type) {
        case 'java-string-practice':
            session.data.students = Array.isArray(session.data.students) ? session.data.students : [];
            session.data.selectedMethods = Array.isArray(session.data.selectedMethods) ? session.data.selectedMethods : ['all'];
            break;
        case 'www-sim':
            session.data.students = Array.isArray(session.data.students) ? session.data.students : [];
            session.data.studentTemplates = session.data.studentTemplates && typeof session.data.studentTemplates === 'object' ? session.data.studentTemplates : {};
            session.data.fragments = Array.isArray(session.data.fragments) ? session.data.fragments : [];
            break;
        case 'raffle':
            session.data.tickets = Array.isArray(session.data.tickets) ? session.data.tickets : [];
            break;
        default:
            // No defaults
            break;
    }
    return session;
}

class InMemorySessionStore {
    constructor(ttlMs = 60 * 60 * 1000) {
        this.ttlMs = ttlMs;
        this.store = Object.create(null);
        
        // Simple janitor, uses sessions' last activity timestamp
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
        this.cleanupInterval.unref?.();
    }

    async get(id) {
        const session = this.store[id];
        if (session) {
            session.lastActivity = Date.now();
        }
        return session || null;
    }

    async set(id, session) {
        this.store[id] = session;
    }

    async delete(id) {
        const existed = !!this.store[id];
        delete this.store[id];
        return existed;
    }

    async touch(id) {
        const session = this.store[id];
        if (session) {
            session.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    async getAll() {
        return Object.values(this.store);
    }

    async getAllIds() {
        return Object.keys(this.store);
    }

    cleanup() {
        const now = Date.now();
        for (const id in this.store) {
            if (now - (this.store[id]?.lastActivity ?? 0) > this.ttlMs) {
                delete this.store[id];
            }
        }
    }

    async close() {
        clearInterval(this.cleanupInterval);
    }

    // Stub methods for compatibility with Valkey store
    subscribeToBroadcast() {}
    initializePubSub() {}
    async publishBroadcast() {}
}

/**
 * Create a session store with a TTL (time-to-live) for sessions.
 * If valkeyUrl is provided, uses Valkey with caching; otherwise uses in-memory store.
 * @param {string|null} valkeyUrl - Valkey connection URL (null for in-memory)
 * @param {number} ttlMs - The time-to-live for sessions in milliseconds.
 * @returns {Object} - The session store with async API.
 */
export function createSessionStore(valkeyUrl = null, ttlMs = 60 * 60 * 1000) {
    if (!valkeyUrl) {
        console.log('Using in-memory session store (no VALKEY_URL configured)');
        return new InMemorySessionStore(ttlMs);
    }

    console.log('Using Valkey session store with caching');
    const valkeyStore = new ValkeySessionStore(valkeyUrl, { ttlMs });
    const cache = new SessionCache({
        ttlMs: 30_000,
        maxSize: 1000,
        touchFn: async (id) => {
            await valkeyStore.touch(id);
        },
    });

    // Wrapper that adds caching layer
    return {
        valkeyStore,
        cache,

        async get(id) {
            const s = await cache.get(id, async (sessionId) => {
                return await valkeyStore.get(sessionId);
            });
            return normalizeSessionData(s);
        },

        async set(id, session, ttl = null) {
            const normalized = normalizeSessionData(session);
            await valkeyStore.set(id, normalized, ttl);
            cache.set(id, normalized, false); // Update cache, not dirty since already written
        },

        async delete(id) {
            cache.invalidate(id);
            return await valkeyStore.delete(id);
        },

        async touch(id) {
            const wasCached = cache.has(id);
            const cached = await this.get(id); // Ensure cached, updates lastActivity locally
            if (!cached) return false;

            cache.touch(id);

            if (!wasCached) {
                // Extend TTL immediately for freshly cached sessions
                await valkeyStore.touch(id);
            }

            return true;
        },

        async getAll() {
            const all = await valkeyStore.getAll();
            return Array.isArray(all) ? all.map(normalizeSessionData) : all;
        },

        async getAllIds() {
            return await valkeyStore.getAllIds();
        },

        cleanup() {
            cache.cleanup();
            // Valkey handles TTL automatically
        },

        async flushCache() {
            await cache.flushTouches(async (id) => {
                await valkeyStore.touch(id);
            });
        },

        async close() {
            await cache.shutdown(async (id) => {
                await valkeyStore.touch(id);
            });
            await valkeyStore.close();
        },

        subscribeToBroadcast(channel, handler) {
            valkeyStore.subscribeToBroadcast(channel, handler);
        },

        initializePubSub() {
            valkeyStore.initializePubSub();
        },

        async publishBroadcast(channel, message) {
            await valkeyStore.publishBroadcast(channel, message);
        }
    };
}

/**
 * Generate a unique lowercase hex ID of at least `length` (default 5) characters, increasing if there
 * are several collisions indicating a high demand for IDs.
 * @param {Object} store - The session store to check for existing IDs.
 * @param {number} [length=5] - The minimum length of the ID.
 */
export async function generateHexId(store, length = 5) {
    let attempts = 0;
    let len = length;

    while (true) {
        const bytes = randomBytes(Math.ceil(len / 2));
        const id = bytes.toString("hex").slice(0, len);
        
        const existing = await store.get(id);
        if (!existing) return id;

        // Soft collision handling: after a few collisions, bump length by 1
        attempts += 1;
        if (attempts > 5) len += 1; // extremely unlikely, but safe
    }
}

/**
 * Create and insert a base session: { id, created, data }
 * @param {Object} store - The session store to insert the session into.
 * @param {Object} [options={}] - Options for the session.
 * @param {Object} [options.data={}] - Initial data for the session.
 */
export async function createSession(store, { data = {} } = {}) {
    const id = await generateHexId(store);
    const now = Date.now();
    const session = normalizeSessionData({ id, created: now, lastActivity: now, data });
    await store.set(id, session);
    return session;
}

/**
 * Setup routes for managing sessions.
 * @param {Object} app - The Express application.
 * @param {Object} sessions - The session store.
 * @param {Object} wss - The WebSocket server (optional).
 */
export function setupSessionRoutes(app, sessions, wss = null) {
    // Utility to normalize a fetched session before use
    const getNormalized = async (id) => {
        const s = await sessions.get(id);
        return s ? normalizeSessionData(s) : null;
    };
    // GET /api/session/:sessionId -> fetch any session (any type)
    app.get("/api/session/:sessionId", async (req, res) => {
        const { sessionId } = req.params;
        const session = await getNormalized(sessionId);
        if (!session) return res.status(404).json({ error: "invalid session" });
        res.json({ session });
    });

    // DELETE /api/session/:sessionId -> delete any session (for cleanup/testing)
    app.delete("/api/session/:sessionId", async (req, res) => {
        const { sessionId } = req.params;
        const session = await getNormalized(sessionId);
        if (!session) return res.status(404).json({ error: "invalid session" });
        
        // Broadcast session-ended message
        if (sessions.publishBroadcast) {
            // Valkey mode: use pub/sub for cross-instance broadcast
            await sessions.publishBroadcast('session-ended', { sessionId });
        } else if (wss) {
            // In-memory mode: direct WebSocket broadcast
            for (const client of wss.clients) {
                if (typeof client.sessionId !== 'undefined' && client.sessionId === sessionId && client.readyState === 1) {
                    client.send(JSON.stringify({ type: 'session-ended' }));
                }
            }
        }
        
        // Check if this is a persistent session and reset it for reuse
        const hash = await findHashBySessionId(sessionId);
        if (hash) {
            await resetPersistentSession(hash);
        }
        
        await sessions.delete(sessionId);
        res.json({ success: true, deleted: sessionId });
    });
}

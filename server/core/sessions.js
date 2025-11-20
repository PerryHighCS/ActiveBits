import { randomBytes } from "crypto";
import { findHashBySessionId, resetPersistentSession } from "./persistentSessions.js";

/**
 * Create a session store with a TTL (time-to-live) for sessions.
 * @param {number} ttlMs - The time-to-live for sessions in milliseconds.
 * @returns {Object} - The session store.
 */
export function createSessionStore(ttlMs = 60 * 60 * 1000) {
    const store = Object.create(null);

    function cleanup() {
        const now = Date.now();
        for (const id in store) {
            if (now - (store[id]?.lastActivity ?? 0) > ttlMs) delete store[id];
        }
    }

    // simple janitor, uses sessions' last activity timestamp
    const t = setInterval(cleanup, 60_000);
    // don't keep the event loop alive just for cleanup in dev
    t.unref?.();

    Object.defineProperty(store, "cleanup", { value: cleanup });

    return new Proxy(store, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (value && typeof value === "object" && "id" in value) {
                value.lastActivity = Date.now();
            }
            return value;
        },
    });
}

/**
 * Generate a unique lowercase hex ID of at least `length` (default 5) characters, increasing if there
 * are several collisions indicating a high demand for IDs.
 * @param {Object} store - The session store to check for existing IDs.
 * @param {number} [length=5] - The minimum length of the ID.
 */
export function generateHexId(store, length = 5) {
    let attempts = 0;
    let len = length;

    while (true) {
        const bytes = randomBytes(Math.ceil(len / 2));
        const id = bytes.toString("hex").slice(0, len);
        if (!store[id]) return id;

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
export function createSession(store, { data = {} } = {}) {
    const id = generateHexId(store);
    const now = Date.now();
    const session = { id, created: now, lastActivity: now, data };
    store[id] = session;
    return session;
}

/**
 * Setup routes for managing sessions.
 * @param {Object} app - The Express application.
 * @param {Object} sessions - The session store.
 * @param {Object} wss - The WebSocket server (optional).
 */
export function setupSessionRoutes(app, sessions, wss = null) {
    // GET /api/session/:sessionId -> fetch any session (any type)
    app.get("/api/session/:sessionId", (req, res) => {
        const { sessionId } = req.params;
        const session = sessions[sessionId];
        if (!session) return res.status(404).json({ error: "invalid session" });
        res.json({ session });
    });

    // DELETE /api/session/:sessionId -> delete any session (for cleanup/testing)
    app.delete("/api/session/:sessionId", (req, res) => {
        const { sessionId } = req.params;
        if (!sessions[sessionId]) return res.status(404).json({ error: "invalid session" });
        
        // Broadcast session-ended message to all connected clients
        if (wss) {
            for (const client of wss.clients) {
                if (client.sessionId === sessionId && client.readyState === 1) {
                    client.send(JSON.stringify({ type: 'session-ended' }));
                }
            }
        }
        
        // Check if this is a persistent session and reset it for reuse
        const hash = findHashBySessionId(sessionId);
        if (hash) {
            resetPersistentSession(hash);
        }
        
        delete sessions[sessionId];
        res.json({ success: true, deleted: sessionId });
    });
}
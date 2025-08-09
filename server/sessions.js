import { randomBytes } from "crypto";

/**
 * Create a session store with a TTL (time-to-live) for sessions.
 * @param {number} ttlMs - The time-to-live for sessions in milliseconds.
 * @returns {Object} - The session store.
 */
export function createSessionStore(ttlMs = 60 * 60 * 1000) {
    const store = Object.create(null);

    // simple janitor, uses sessions' created timestamp
    const t = setInterval(() => {
        const now = Date.now();
        for (const id in store) {
            if (now - (store[id]?.created ?? 0) > ttlMs) delete store[id];
        }
    }, 60_000);
    // don't keep the event loop alive just for cleanup in dev
    t.unref?.();

    return store;
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
    const id = generateHexId(store, 6); // keep at 6 hex chars
    const session = { id, created: Date.now(), data };
    store[id] = session;
    return session;
}

/**
 * Setup routes for managing sessions.
 * @param {Object} app - The Express application.
 * @param {Object} sessions - The session store.
 */
export function setupSessionRoutes(app, sessions) {
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
        delete sessions[sessionId];
        res.json({ success: true, deleted: sessionId });
    });
}
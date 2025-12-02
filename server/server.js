import http from "http";
import express from "express";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { createSessionStore, setupSessionRoutes } from "./core/sessions.js";
import { createWsRouter } from "./core/wsRouter.js";
import { generatePersistentHash, getOrCreateActivePersistentSession, getPersistentSession, verifyTeacherCodeWithHash, initializePersistentStorage } from "./core/persistentSessions.js";
import { setupPersistentSessionWs } from "./core/persistentSessionWs.js";
import { ALLOWED_ACTIVITIES, isValidActivity, registerActivityRoutes } from "./activities/activityRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // Parse JSON request bodies
app.use(cookieParser()); // Parse cookies (unsigned)

const server = http.createServer(app);

// Initialize session storage (Valkey if VALKEY_URL is set, otherwise in-memory)
const valkeyUrl = process.env.VALKEY_URL || null;
const sessionTtl = Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000;
const sessions = createSessionStore(valkeyUrl, sessionTtl);
app.locals.sessions = sessions;

// Initialize pub/sub if using Valkey
if (sessions.initializePubSub) {
  sessions.initializePubSub();
}

// Initialize persistent session storage backend
if (valkeyUrl && sessions.valkeyStore) {
  // Use the same Valkey client for persistent sessions
  initializePersistentStorage(sessions.valkeyStore.client);
} else {
  // Use in-memory storage
  initializePersistentStorage(null);
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_COOKIE = 20;

const ws = createWsRouter(server, sessions);

setupSessionRoutes(app, sessions, ws.wss);

// Setup persistent session WebSocket handling
setupPersistentSessionWs(ws, sessions);

// Attach feature-specific route handlers (discover modules dynamically)
await registerActivityRoutes(app, sessions, ws);

/**
 * Parse persistent sessions cookie and normalize to array format
 * Supports both new array format [{key, teacherCode}] and legacy object format
 * @param {string|object} cookieValue - The cookie value from req.cookies
 * @param {string} [context] - Optional context label for logging
 * @returns {object} - { sessions: Array, corrupted: boolean, error: string|null }
 */
function parsePersistentSessionsCookie(cookieValue, context = 'persistent_sessions') {
    if (!cookieValue) {
        return { sessions: [], corrupted: false, error: null };
    }

    let parsedCookie;
    try {
        parsedCookie = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
    } catch (e) {
        console.error(
            `Failed to parse ${context} cookie; returning empty sessions`,
            {
                error: e,
                cookieLength: typeof cookieValue === 'string' ? cookieValue.length : null,
                cookieType: typeof cookieValue,
            },
        );
        return { sessions: [], corrupted: true, error: 'Invalid JSON format' };
    }

    // Support both array format (new) and object format (legacy)
    if (Array.isArray(parsedCookie)) {
        // New format: array of {key, teacherCode} objects with explicit insertion order
        return { sessions: parsedCookie, corrupted: false, error: null };
    } else if (typeof parsedCookie === 'object' && parsedCookie !== null) {
        // Legacy format: plain object (migration path)
        const sessions = Object.keys(parsedCookie).map(key => ({
            key,
            teacherCode: parsedCookie[key]
        }));
        return { sessions, corrupted: false, error: null };
    }

    console.error(
        `Invalid cookie format for ${context}: expected array or object`,
        { cookieType: typeof parsedCookie },
    );
    return { sessions: [], corrupted: true, error: 'Invalid cookie format: expected array or object' };
}

// Persistent session routes
// Get list of teacher's persistent sessions from cookies (must be before :hash routes)
// SECURITY: This endpoint only returns sessions stored in the requester's own cookies.
// No authentication needed - users can only see their own sessions, as cookies are per-client.
// An attacker could enumerate hashes, but they wouldn't have the teacher codes to start sessions.
app.get("/api/persistent-session/list", (req, res) => {
    try {
        const { sessions: sessionEntries } = parsePersistentSessionsCookie(
            req.cookies?.['persistent_sessions'],
            'persistent_sessions (/api/persistent-session/list)'
        );

        // Convert cookie entries to session list with URLs and teacher codes
        const sessions = sessionEntries
            .map(entry => {
                const parts = entry.key.split(':');
                // Validate key format (should be "activityName:hash")
                if (parts.length !== 2 || !parts[0] || !parts[1]) {
                    console.warn(`Invalid session key format: "${entry.key}"`);
                    return null; // Skip invalid entries
                }
                
                const [activityName, hash] = parts;
                // Use X-Forwarded-Host and X-Forwarded-Proto if available (for proxied environments)
                const host = req.get('x-forwarded-host') || req.get('host');
                const protocol = req.get('x-forwarded-proto') || req.protocol;
                return {
                    activityName,
                    hash,
                    teacherCode: entry.teacherCode, // Include teacher code from cookie
                    url: `/activity/${activityName}/${hash}`,
                    fullUrl: `${protocol}://${host}/activity/${activityName}/${hash}`
                };
            })
            .filter(session => session !== null); // Remove invalid entries

        res.json({ sessions });
    } catch (err) {
        console.error('Error in /api/persistent-session/list:', err);
        res.status(500).json({ error: 'Internal server error', sessions: [] });
    }
});

app.post("/api/persistent-session/create", (req, res) => {
    const { activityName, teacherCode } = req.body;

    if (!activityName || !teacherCode) {
        return res.status(400).json({ error: 'Missing activityName or teacherCode' });
    }

    // Validate teacherCode type
    if (typeof teacherCode !== 'string') {
        return res.status(400).json({ error: 'Teacher code must be a string' });
    }

    // Validate activityName is allowed
    if (!isValidActivity(activityName)) {
        return res.status(400).json({ 
            error: 'Invalid activity name', 
            allowedActivities: ALLOWED_ACTIVITIES 
        });
    }

    // Validate teacherCode length (prevent DoS through extremely long strings)
    const MAX_TEACHER_CODE_LENGTH = 100;
    if (teacherCode.length < 6) {
        return res.status(400).json({ error: 'Teacher code must be at least 6 characters' });
    }
    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
        return res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` });
    }

    const { hash } = generatePersistentHash(activityName, teacherCode);

    const url = `/activity/${activityName}/${hash}`;
    
    // Set cookie to remember this persistent session
    // SECURITY NOTE: Teacher codes are stored in plain text in cookies for convenience.
    // This is intentional for this educational tool - the codes are meant to be simple barriers,
    // not cryptographic security. Users should NOT use sensitive passwords as teacher codes.
    // The HMAC hash provides integrity (preventing URL tampering) but not confidentiality.
    //
    // SIZE NOTE: Cookies have a size limit (~4KB). We limit to 20 sessions to stay well under this limit.
    // Each entry is roughly ~100 bytes (activityName:hash + teacherCode), so 20 sessions ≈ 2KB.
    // Alternative approaches for more sessions: localStorage (client-side), or database (server-side).
    //
    // FORMAT NOTE: We use an array format [{key, teacherCode}, ...] to maintain explicit insertion order
    // for FIFO eviction. This is more reliable than depending on object key insertion order.
    const cookieName = 'persistent_sessions';
    let { sessions: existingSessions } = parsePersistentSessionsCookie(
        req.cookies[cookieName],
        'persistent_sessions (/api/persistent-session/create)'
    );
    
    const newKey = `${activityName}:${hash}`;
    
    // Check if this session already exists and update it (move to end)
    const existingIndex = existingSessions.findIndex(s => s.key === newKey);
    if (existingIndex !== -1) {
        existingSessions.splice(existingIndex, 1);
    }
    
    // Add new session at the end (most recent)
    existingSessions.push({ key: newKey, teacherCode });
    
    // Enforce limit: if over limit, remove oldest entries (FIFO - remove from start of array)
    if (existingSessions.length > MAX_SESSIONS_PER_COOKIE) {
        existingSessions = existingSessions.slice(-MAX_SESSIONS_PER_COOKIE);
    }
    
    // SECURITY: httpOnly protects against XSS attacks by preventing client-side JavaScript access.
    // Teacher codes are retrieved via /api/persistent-session/list instead of document.cookie.
    // The secure flag ensures cookies are only sent over HTTPS in production.
    res.cookie(cookieName, JSON.stringify(existingSessions), {
        maxAge: ONE_YEAR_MS, // 1 year
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true, // Prevent client-side JavaScript access (XSS protection)
    });

    res.json({ url, hash });
});

// Verify teacher code for an existing persistent link and store cookie for future visits
app.post("/api/persistent-session/authenticate", async (req, res) => {
    const { activityName, hash, teacherCode } = req.body || {};

    if (!activityName || !hash || !teacherCode) {
        return res.status(400).json({ error: 'Missing activityName, hash, or teacherCode' });
    }

    if (!isValidActivity(activityName)) {
        return res.status(400).json({
            error: 'Invalid activity name',
            allowedActivities: ALLOWED_ACTIVITIES
        });
    }

    if (typeof teacherCode !== 'string') {
        return res.status(400).json({ error: 'Teacher code must be a string' });
    }

    const MAX_TEACHER_CODE_LENGTH = 100;
    if (teacherCode.length < 6) {
        return res.status(400).json({ error: 'Teacher code must be at least 6 characters' });
    }
    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
        return res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` });
    }

    const validation = verifyTeacherCodeWithHash(activityName, hash, teacherCode);
    if (!validation.valid) {
        return res.status(401).json({ error: validation.error || 'Invalid teacher code' });
    }

    // Store/update cookie entry so the instructor is recognized on subsequent visits
    const cookieName = 'persistent_sessions';
    let { sessions: existingSessions } = parsePersistentSessionsCookie(
        req.cookies[cookieName],
        'persistent_sessions (/api/persistent-session/authenticate)'
    );

    const newKey = `${activityName}:${hash}`;
    const existingIndex = existingSessions.findIndex(s => s.key === newKey);
    if (existingIndex !== -1) {
        existingSessions.splice(existingIndex, 1);
    }
    existingSessions.push({ key: newKey, teacherCode });
    if (existingSessions.length > MAX_SESSIONS_PER_COOKIE) {
        existingSessions = existingSessions.slice(-MAX_SESSIONS_PER_COOKIE);
    }

    res.cookie(cookieName, JSON.stringify(existingSessions), {
        maxAge: ONE_YEAR_MS, // 1 year
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
    });

    const persistentSession = await getPersistentSession(hash);

    res.json({
        success: true,
        isStarted: !!persistentSession?.sessionId,
        sessionId: persistentSession?.sessionId || null,
    });
});

// Get persistent session info (for checking if teacher has cookie)
app.get("/api/persistent-session/:hash", async (req, res) => {
    const { hash } = req.params;
    const { activityName } = req.query;
    
    if (!activityName) {
        return res.status(400).json({ error: 'Missing activityName parameter' });
    }
    
    // Get or create the active session (this creates it in memory when first accessed)
    const session = await getOrCreateActivePersistentSession(activityName, hash);

    // Check if user has the teacher code in their cookies
    const { sessions: sessionEntries, corrupted: cookieCorrupted } = parsePersistentSessionsCookie(
        req.cookies?.['persistent_sessions'],
        'persistent_sessions (/api/persistent-session/:hash)'
    );
    const cookieKey = `${activityName}:${hash}`;
    const hasTeacherCookie = sessionEntries.some(s => s.key === cookieKey);

    res.json({
        activityName: session.activityName,
        hasTeacherCookie,
        cookieCorrupted, // Inform client if cookie was corrupted
        isStarted: !!session.sessionId,
        sessionId: session.sessionId,
    });
});

// Get teacher code from cookie (for auto-authentication)
app.get("/api/persistent-session/:hash/teacher-code", (req, res) => {
    const { hash } = req.params;
    const { activityName } = req.query;
    
    if (!activityName) {
        return res.status(400).json({ error: 'Missing activityName parameter' });
    }

    const { sessions: sessionEntries } = parsePersistentSessionsCookie(
        req.cookies?.['persistent_sessions'],
        'persistent_sessions (/api/persistent-session/:hash/teacher-code)'
    );
    const cookieKey = `${activityName}:${hash}`;
    const entry = sessionEntries.find(s => s.key === cookieKey);
    const teacherCode = entry?.teacherCode || null;

    if (teacherCode) {
        res.json({ teacherCode });
    } else {
        res.status(404).json({ error: 'No teacher code found' });
    }
});

// Health check
app.get("/health-check", (req, res) => {
    res.json({ status: "ok", memory: process.memoryUsage() });
});

// HTML Status Dashboard removed; served by client SPA at /status

// Status endpoint with runtime and storage details
app.get("/api/status", async (req, res) => {
    try {
        const usingValkey = Boolean(sessions && sessions.valkeyStore);
        const valkeyClient = usingValkey ? sessions.valkeyStore.client : null;
        const ttlMs = usingValkey ? sessions.valkeyStore.ttlMs : sessions.ttlMs;

        // Gather active sessions
        const allSessions = (await sessions.getAll()) || [];

        // Compute per-session socket counts
        const socketCounts = Object.create(null);
        const clients = ws?.wss?.clients ? Array.from(ws.wss.clients) : [];
        for (const c of clients) {
            const id = c.sessionId || null;
            if (!id) continue;
            socketCounts[id] = (socketCounts[id] || 0) + 1;
        }

        // Helper to mask credentials in URLs
        const maskUrl = (url) => {
            try {
                if (!url) return null;
                const u = new URL(url);
                if (u.password || u.username) {
                    u.password = u.password ? "****" : "";
                    u.username = u.username ? "****" : "";
                }
                return u.toString();
            } catch {
                return url;
            }
        };

        // Build session summaries with expiry
        const now = Date.now();
        const sessionsSummary = [];
        let approxBytes = 0;
        for (const s of allSessions) {
            let ttlRemainingMs = null;
            if (usingValkey && valkeyClient && s?.id) {
                try {
                    // Prefer accurate TTL from Valkey if available
                    // eslint-disable-next-line no-await-in-loop
                    const pttl = await valkeyClient.pttl(`session:${s.id}`);
                    ttlRemainingMs = pttl >= 0 ? pttl : Math.max(0, ttlMs - (now - (s.lastActivity || s.created || 0)));
                } catch {
                    ttlRemainingMs = Math.max(0, ttlMs - (now - (s.lastActivity || s.created || 0)));
                }
            } else {
                ttlRemainingMs = Math.max(0, ttlMs - (now - (s.lastActivity || s.created || 0)));
            }

            const expiresAt = Number.isFinite(ttlRemainingMs) ? new Date(now + ttlRemainingMs).toISOString() : null;
            const approxSize = Buffer.byteLength(JSON.stringify(s || {}));
            approxBytes += approxSize;
            sessionsSummary.push({
                id: s.id,
                type: s.type || null,
                created: s.created ? new Date(s.created).toISOString() : null,
                lastActivity: s.lastActivity ? new Date(s.lastActivity).toISOString() : null,
                ttlRemainingMs,
                expiresAt,
                socketCount: socketCounts[s.id] || 0,
                approxBytes: approxSize,
            });
        }

        // Aggregate by activity type
        const activityCounts = sessionsSummary.reduce((acc, s) => {
            const key = s.type || "unknown";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        // Valkey info (optional, only lightweight sections)
        let valkeyInfo = null;
        if (usingValkey && valkeyClient) {
            try {
                const [ping, infoMemory, dbsize] = await Promise.all([
                    valkeyClient.ping(),
                    valkeyClient.info("memory"),
                    valkeyClient.dbsize(),
                ]);
                // Parse a couple of useful metrics from INFO memory
                const mem = {};
                for (const line of infoMemory.split("\n")) {
                    const [k, v] = line.split(":");
                    if (!k || v === undefined) continue;
                    if (k === "used_memory" || k === "used_memory_rss" || k === "maxmemory") {
                        mem[k] = Number(v.trim());
                    }
                    if (k === "used_memory_human" || k === "used_memory_rss_human") {
                        mem[k] = v.trim();
                    }
                }
                valkeyInfo = {
                    ping,
                    dbsize,
                    memory: mem,
                };
            } catch (e) {
                valkeyInfo = { error: String(e?.message || e) };
            }
        }

        const response = {
            storage: {
                mode: usingValkey ? "valkey" : "in-memory",
                ttlMs,
                valkeyUrl: usingValkey ? maskUrl(process.env.VALKEY_URL) : null,
            },
            process: {
                pid: process.pid,
                node: process.version,
                uptimeSeconds: Math.round(process.uptime()),
                memory: process.memoryUsage(),
                loadavg: os.loadavg(),
            },
            websocket: {
                connectedClients: clients.length,
            },
            sessions: {
                count: sessionsSummary.length,
                approxTotalBytes: approxBytes,
                byType: activityCounts,
                list: sessionsSummary,
            },
            valkey: valkeyInfo,
        };

        res.json(response);
    } catch (err) {
        console.error("/api/status error", err);
        res.status(500).json({ error: "internal_error", message: String(err?.message || err) });
    }
});

// Static files / Vite proxy
const env = process.env.NODE_ENV || "development";
if (!env.startsWith("dev")) {
    // In production mode, serve static files from the React build directory
    const distDir = path.join(__dirname, "../client/dist");
    app.use(express.static(distDir));

    // SPA fallback: serve index.html for non-API routes
    app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
        res.sendFile(path.join(distDir, "index.html"));
    });
} else {
    // Development mode: proxy requests to Vite
    const { createProxyMiddleware } = await import("http-proxy-middleware");
    const viteProxy = createProxyMiddleware({
        target: "http://localhost:5173",
        changeOrigin: true,
        logLevel: "warn",
        timeout: 30000,
        proxyTimeout: 30000,
    });
    app.use((req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        if (req.path.startsWith("/ws")) return next();
        return viteProxy(req, res, next);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ActiveBits server running on \x1b[1m\x1b[32mhttp://localhost:${PORT}\x1b[0m`);
});

// Graceful shutdown handler for hot redeployments
let shutdownInProgress = false;
async function shutdown(signal) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(async () => {
        console.log('HTTP server closed');
        
        // Flush cache to Valkey before shutdown
        if (sessions.flushCache) {
            console.log('Flushing session cache...');
            await sessions.flushCache();
        }
        
        // Close Valkey connections
        if (sessions.close) {
            console.log('Closing Valkey connections...');
            await sessions.close();
        }
        
        console.log('Graceful shutdown complete');
        process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

// Periodic cache flush (every 30 seconds) to ensure data persistence
if (sessions.flushCache) {
    const flushInterval = setInterval(async () => {
        try {
            await sessions.flushCache();
        } catch (err) {
            console.error('Error flushing cache:', err);
        }
    }, 30000);
    flushInterval.unref();
}

import http from "http";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { createSessionStore, setupSessionRoutes } from "./core/sessions.js";
import { createWsRouter } from "./core/wsRouter.js";
import { generatePersistentHash, getOrCreateActivePersistentSession } from "./core/persistentSessions.js";
import { setupPersistentSessionWs } from "./core/persistentSessionWs.js";
import setupRaffleRoutes from "./activities/raffle/routes.js";
import setupWwwSimRoutes from "./activities/www-sim/routes.js";
import setupJavaStringPracticeRoutes from "./activities/java-string-practice/routes.js";
import { ALLOWED_ACTIVITIES, isValidActivity } from "./activities/activityRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // Parse JSON request bodies
app.use(cookieParser()); // Parse cookies (unsigned)

const server = http.createServer(app);

// In-memory store shared by all session types
const sessionTtl = Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000;
const sessions = createSessionStore(sessionTtl);
app.locals.sessions = sessions;

const ws = createWsRouter(server, sessions);

setupSessionRoutes(app, sessions, ws.wss);

// Setup persistent session WebSocket handling
setupPersistentSessionWs(ws, sessions);

// Attach feature-specific route handlers
setupRaffleRoutes(app, sessions, ws);
setupWwwSimRoutes(app, sessions, ws);
setupJavaStringPracticeRoutes(app, sessions, ws);

/**
 * Parse persistent sessions cookie and normalize to array format
 * Supports both new array format [{key, teacherCode}] and legacy object format
 * @param {string|object} cookieValue - The cookie value from req.cookies
 * @returns {object} - { sessions: Array, corrupted: boolean, error: string|null }
 */
function parsePersistentSessionsCookie(cookieValue) {
    if (!cookieValue) {
        return { sessions: [], corrupted: false, error: null };
    }

    let parsedCookie;
    try {
        parsedCookie = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
    } catch (e) {
        console.error('Failed to parse persistent-sessions cookie:', e);
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

    console.error('Invalid cookie format: expected array or object, got', typeof parsedCookie);
    return { sessions: [], corrupted: true, error: 'Invalid cookie format: expected array or object' };
}

// Persistent session routes
// Get list of teacher's persistent sessions from cookies (must be before :hash routes)
// SECURITY: This endpoint only returns sessions stored in the requester's own cookies.
// No authentication needed - users can only see their own sessions, as cookies are per-client.
// An attacker could enumerate hashes, but they wouldn't have the teacher codes to start sessions.
app.get("/api/persistent-session/list", (req, res) => {
    try {
        const { sessions: sessionEntries } = parsePersistentSessionsCookie(req.cookies?.['persistent_sessions']);

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
    const MAX_SESSIONS_PER_COOKIE = 20;
    let { sessions: existingSessions } = parsePersistentSessionsCookie(req.cookies[cookieName]);
    
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
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true, // Prevent client-side JavaScript access (XSS protection)
    });

    res.json({ url, hash });
});

// Get persistent session info (for checking if teacher has cookie)
app.get("/api/persistent-session/:hash", (req, res) => {
    const { hash } = req.params;
    const { activityName } = req.query;
    
    if (!activityName) {
        return res.status(400).json({ error: 'Missing activityName parameter' });
    }
    
    // Get or create the active session (this creates it in memory when first accessed)
    const session = getOrCreateActivePersistentSession(activityName, hash);

    // Check if user has the teacher code in their cookies
    const { sessions: sessionEntries, corrupted: cookieCorrupted } = parsePersistentSessionsCookie(req.cookies?.['persistent_sessions']);
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

    const { sessions: sessionEntries } = parsePersistentSessionsCookie(req.cookies?.['persistent_sessions']);
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

// Static files / Vite proxy
const env = process.env.NODE_ENV || "development";
if (!env.startsWith("dev")) {
    // In production mode, serve static files from the React build directory
    app.use(express.static(path.join(__dirname, "../client/dist")));

    // All other requests should simply serve the React app
    app.get("/*fallback", (req, res) => {
        res.sendFile(path.join(__dirname, "../client/dist/index.html"));
    });
} else {
    // Development mode: proxy requests to Vite
    process.on("warning", e => console.warn(e.stack));
    const { createProxyMiddleware } = await import("http-proxy-middleware");
    const viteProxy = createProxyMiddleware({
        target: "http://localhost:5173",
        changeOrigin: true,
        logLevel: "silent",
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
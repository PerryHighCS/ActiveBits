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

// Persistent session routes
// Get list of teacher's persistent sessions from cookies (must be before :hash routes)
// SECURITY: This endpoint only returns sessions stored in the requester's own cookies.
// No authentication needed - users can only see their own sessions, as cookies are per-client.
// An attacker could enumerate hashes, but they wouldn't have the teacher codes to start sessions.
app.get("/api/persistent-session/list", (req, res) => {
    try {
        const cookieValue = req.cookies?.['persistent_sessions'];
        
        if (!cookieValue) {
            return res.json({ sessions: [] });
        }

        let savedSessions = {};
        try {
            savedSessions = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
        } catch (e) {
            console.error('Failed to parse persistent-sessions cookie:', e);
            return res.json({ sessions: [] });
        }

        // Convert cookie entries to session list with URLs and teacher codes
        const sessions = Object.keys(savedSessions).map(key => {
            const [activityName, hash] = key.split(':');
            // Use X-Forwarded-Host and X-Forwarded-Proto if available (for proxied environments)
            const host = req.get('x-forwarded-host') || req.get('host');
            const protocol = req.get('x-forwarded-proto') || req.protocol;
            return {
                activityName,
                hash,
                teacherCode: savedSessions[key], // Include teacher code from cookie
                url: `/activity/${activityName}/${hash}`,
                fullUrl: `${protocol}://${host}/activity/${activityName}/${hash}`
            };
        });

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

    // Validate activityName is allowed
    if (!isValidActivity(activityName)) {
        return res.status(400).json({ 
            error: 'Invalid activity name', 
            allowedActivities: ALLOWED_ACTIVITIES 
        });
    }

    if (teacherCode.length < 6) {
        return res.status(400).json({ error: 'Teacher code must be at least 6 characters' });
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
    const cookieName = 'persistent_sessions';
    const MAX_SESSIONS_PER_COOKIE = 20;
    let existingSessions = {};
    
    try {
        const cookieValue = req.cookies[cookieName];
        if (cookieValue) {
            existingSessions = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
            // Validate it's an object
            if (typeof existingSessions !== 'object' || Array.isArray(existingSessions)) {
                console.error('Invalid cookie format during creation: expected object, got', typeof existingSessions);
                existingSessions = {}; // Reset to empty if corrupted
            }
        }
    } catch (err) {
        console.error('Error parsing existing cookie:', err);
        existingSessions = {}; // Reset to empty if corrupted
    }
    
    // Add new session
    existingSessions[`${activityName}:${hash}`] = teacherCode;
    
    // Enforce limit: if over limit, remove oldest entries (simple FIFO approach)
    const sessionKeys = Object.keys(existingSessions);
    if (sessionKeys.length > MAX_SESSIONS_PER_COOKIE) {
        // Remove the first (oldest) entries until we're at the limit
        const toRemove = sessionKeys.length - MAX_SESSIONS_PER_COOKIE;
        for (let i = 0; i < toRemove; i++) {
            delete existingSessions[sessionKeys[i]];
        }
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
    const cookieName = 'persistent_sessions';
    let savedSessions = {};
    let cookieCorrupted = false;
    
    try {
        const cookieValue = req.cookies[cookieName];
        if (cookieValue) {
            savedSessions = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
            // Validate it's an object
            if (typeof savedSessions !== 'object' || Array.isArray(savedSessions)) {
                console.error('Invalid cookie format: expected object, got', typeof savedSessions);
                savedSessions = {};
                cookieCorrupted = true;
            }
        }
    } catch (err) {
        console.error('Error parsing persistent_sessions cookie:', err);
        cookieCorrupted = true;
    }
    
    const cookieKey = `${activityName}:${hash}`;
    const hasTeacherCookie = !!savedSessions[cookieKey];

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

    const cookieName = 'persistent_sessions';
    let savedSessions = {};
    
    try {
        const cookieValue = req.cookies[cookieName];
        if (cookieValue) {
            savedSessions = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
            // Validate it's an object
            if (typeof savedSessions !== 'object' || Array.isArray(savedSessions)) {
                console.error('Invalid cookie format: expected object, got', typeof savedSessions);
                return res.status(400).json({ 
                    error: 'Cookie corrupted',
                    message: 'Your saved sessions cookie is corrupted. Please clear your cookies and create a new permanent link.'
                });
            }
        }
    } catch (err) {
        console.error('Error parsing persistent_sessions cookie:', err);
        return res.status(400).json({ 
            error: 'Cookie parsing failed',
            message: 'Your saved sessions cookie is corrupted. Please clear your cookies and create a new permanent link.'
        });
    }
    
    const cookieKey = `${activityName}:${hash}`;
    const teacherCode = savedSessions[cookieKey];

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
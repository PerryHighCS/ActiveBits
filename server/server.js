import http from "http";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { createSessionStore, setupSessionRoutes } from "./core/sessions.js";
import { createWsRouter } from "./core/wsRouter.js";
import { generatePersistentHash, getOrCreateActivePersistentSession, getPersistentSession, hashTeacherCode } from "./core/persistentSessions.js";
import { setupPersistentSessionWs } from "./core/persistentSessionWs.js";
import setupRaffleRoutes from "./activities/raffle/routes.js";
import setupWwwSimRoutes from "./activities/www-sim/routes.js";
import setupJavaStringPracticeRoutes from "./activities/java-string-practice/routes.js";

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
setupSessionRoutes(app, sessions);

const ws = createWsRouter(server, sessions);

// Setup persistent session WebSocket handling
setupPersistentSessionWs(ws, sessions);

// Attach feature-specific route handlers
setupRaffleRoutes(app, sessions, ws);
setupWwwSimRoutes(app, sessions, ws);
setupJavaStringPracticeRoutes(app, sessions, ws);

// Persistent session routes
app.post("/api/persistent-session/create", (req, res) => {
    const { activityName, teacherCode } = req.body;

    if (!activityName || !teacherCode) {
        return res.status(400).json({ error: 'Missing activityName or teacherCode' });
    }

    if (teacherCode.length < 6) {
        return res.status(400).json({ error: 'Teacher code must be at least 6 characters' });
    }

    const { hash } = generatePersistentHash(activityName, teacherCode);

    const url = `/activity/${activityName}/${hash}`;
    
    // Set cookie to remember this persistent session
    const cookieName = 'persistent_sessions';
    let existingSessions = {};
    
    try {
        const cookieValue = req.cookies[cookieName];
        if (cookieValue) {
            existingSessions = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
        }
    } catch (err) {
        console.error('Error parsing existing cookie:', err);
    }
    
    existingSessions[`${activityName}:${hash}`] = teacherCode;
    
    res.cookie(cookieName, JSON.stringify(existingSessions), {
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
        sameSite: 'lax',
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
    
    try {
        const cookieValue = req.cookies[cookieName];
        console.log('Cookie value:', cookieValue, 'Type:', typeof cookieValue);
        if (cookieValue) {
            // Cookie-parser automatically decodes, but if it's a string, parse it
            savedSessions = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
            console.log('Parsed sessions:', savedSessions);
        }
    } catch (err) {
        console.error('Error parsing persistent_sessions cookie:', err);
    }
    
    const cookieKey = `${activityName}:${hash}`;
    console.log('Looking for key:', cookieKey, 'Found:', !!savedSessions[cookieKey]);
    const hasTeacherCookie = !!savedSessions[cookieKey];

    res.json({
        activityName: session.activityName,
        hasTeacherCookie,
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
        }
    } catch (err) {
        console.error('Error parsing persistent_sessions cookie:', err);
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
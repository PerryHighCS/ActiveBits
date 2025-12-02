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
    const MAX_SESSIONS_PER_COOKIE = 20;
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

// HTML Status Dashboard (auto-updating)
app.get("/status", (req, res) => {
        const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ActiveBits Status</title>
    <style>
        :root { --bg:#0e1116; --card:#151a22; --text:#e8eef8; --muted:#a7b0bf; --good:#38c172; --warn:#ffcc00; --bad:#e5534b; --accent:#4ea1ff; }
        * { box-sizing: border-box; }
        body { margin: 0; font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, sans-serif; background: var(--bg); color: var(--text); }
        header { padding: 16px 20px; border-bottom: 1px solid #1e2633; display:flex; align-items:center; gap:12px; }
        header h1 { font-size: 18px; margin: 0; }
        .container { padding: 16px 20px; display: grid; gap: 16px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
        .card { background: var(--card); border: 1px solid #1e2633; border-radius: 10px; padding: 12px; }
        .card h3 { margin: 0 0 6px; font-size: 13px; color: var(--muted); font-weight: 600; letter-spacing: .02em; }
        .value { font-size: 20px; font-weight: 700; }
        .sub { font-size: 12px; color: var(--muted); }
        .controls { display:flex; gap:8px; margin-left:auto; }
        button, select { background:#1b2330; color:var(--text); border:1px solid #253043; border-radius:8px; padding:6px 10px; cursor:pointer; }
        button:hover { background:#202a3a; }
        .table-card { overflow:auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; border-bottom: 1px solid #1f2836; text-align: left; white-space: nowrap; }
        th { position: sticky; top: 0; background: #121721; z-index:1; font-size:12px; color: var(--muted); }
        .ok { color: var(--good); }
        .warn { color: var(--warn); }
        .bad { color: var(--bad); }
        code { background:#0c1016; padding:2px 6px; border-radius:6px; border:1px solid #1a2332; }
        .kvs { display:grid; grid-template-columns: max-content 1fr; gap:6px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:12px; }
        .kvs div:nth-child(odd) { color: var(--muted); }
    </style>
    <script>
        const fmtInt = n => (typeof n === 'number' && Number.isFinite(n)) ? n.toLocaleString() : '-';
        const fmtBytes = n => {
            if (!(Number.isFinite(n))) return '-';
            const u=['B','KB','MB','GB','TB']; let i=0, v=n;
            while (v >= 1024 && i < u.length-1) { v/=1024; i++; }
            return v.toFixed(v<10?1:0)+' '+u[i];
        };
        const esc = s => String(s).replace(/[&<>"']/g, c => (
            c === '&' ? '&amp;' :
            c === '<' ? '&lt;' :
            c === '>' ? '&gt;' :
            c === '"' ? '&quot;' :
            '&#39;'
        ));
        let timer = null;
        let paused = false;
        let last;
        async function load() {
            try {
                const res = await fetch('/api/status', { cache: 'no-store' });
                const data = await res.json();
                last = data;
                render(data);
            } catch (e) {
                console.error(e);
                document.getElementById('error').textContent = 'Failed to load: ' + e;
            }
        }
        function setPaused(p) {
            paused = p;
            document.getElementById('pauseBtn').style.display = p ? 'none' : '';
            document.getElementById('resumeBtn').style.display = p ? '' : 'none';
        }
        function start(intervalMs) {
            if (timer) clearInterval(timer);
            timer = setInterval(() => { if (!paused) load(); }, intervalMs);
        }
        function render(data) {
            // Header cards
            document.getElementById('mode').textContent = data.storage?.mode || '-';
            document.getElementById('ttl').textContent = (data.storage?.ttlMs ? (data.storage.ttlMs/1000)+'s' : '-');
            document.getElementById('uptime').textContent = (data.process?.uptimeSeconds ?? '-') + 's';
            const mem = data.process?.memory || {};
            document.getElementById('rss').textContent = fmtBytes(mem.rss);
            document.getElementById('heap').textContent = fmtBytes(mem.heapUsed) + ' / ' + fmtBytes(mem.heapTotal);
            document.getElementById('wsClients').textContent = fmtInt(data.websocket?.connectedClients);
            document.getElementById('sessionsCount').textContent = fmtInt(data.sessions?.count);
            document.getElementById('sessionsBytes').textContent = fmtBytes(data.sessions?.approxTotalBytes);

            // Session type distribution
            const byType = data.sessions?.byType || {};
            document.getElementById('byType').innerHTML = Object.keys(byType)
                .sort()
                .map(k => '<div>' + esc(k) + '</div><div>' + fmtInt(byType[k]) + '</div>')
                .join('') || '<div>none</div><div>0</div>';

            // Valkey block
            const vk = data.valkey;
            const vkEl = document.getElementById('valkey');
            if (vk && !vk.error) {
                vkEl.innerHTML = '<div>ping</div><div><code>' + esc(vk.ping) + '</code></div>'
                                + '<div>dbsize</div><div>' + fmtInt(vk.dbsize) + '</div>'
                                + '<div>used_memory</div><div>' + fmtBytes(Number(vk.memory?.used_memory)) + ' (' + esc(vk.memory?.used_memory_human || '-') + ')</div>'
                                + '<div>used_memory_rss</div><div>' + fmtBytes(Number(vk.memory?.used_memory_rss)) + ' (' + esc(vk.memory?.used_memory_rss_human || '-') + ')</div>';
            } else if (vk && vk.error) {
                vkEl.innerHTML = '<div>error</div><div class="bad">' + esc(vk.error) + '</div>';
            } else {
                vkEl.innerHTML = '<div>info</div><div>not using Valkey</div>';
            }

            // Sessions table
            const rows = (data.sessions?.list || []).sort((a,b)=>{
                const as = a.lastActivity ? Date.parse(a.lastActivity) : 0;
                const bs = b.lastActivity ? Date.parse(b.lastActivity) : 0;
                return bs - as;
            }).map(s => {
                const ttl = (typeof s.ttlRemainingMs === 'number') ? (s.ttlRemainingMs/1000).toFixed(0)+'s' : '-';
                const cls = (s.socketCount>0 ? 'ok' : '');
                return '<tr>'
                    + '<td><code>' + esc(s.id) + '</code></td>'
                    + '<td>' + esc(s.type || '-') + '</td>'
                    + '<td class="' + cls + '">' + fmtInt(s.socketCount) + '</td>'
                    + '<td>' + esc(s.lastActivity || '-') + '</td>'
                    + '<td>' + esc(s.expiresAt || '-') + '</td>'
                    + '<td>' + ttl + '</td>'
                    + '<td>' + fmtBytes(s.approxBytes) + '</td>'
                + '</tr>';
            }).join('');
            document.getElementById('sessionsBody').innerHTML = rows || '<tr><td colspan="7" class="sub">No sessions</td></tr>';

            document.getElementById('updated').textContent = new Date().toLocaleTimeString();
        }
        window.addEventListener('DOMContentLoaded', () => {
            const intervalSel = document.getElementById('interval');
            intervalSel.addEventListener('change', () => start(Number(intervalSel.value)));
            document.getElementById('pauseBtn').addEventListener('click', ()=> setPaused(true));
            document.getElementById('resumeBtn').addEventListener('click', ()=> setPaused(false));
            start(Number(intervalSel.value));
            load();
        });
    </script>
    <meta http-equiv="refresh" content="3600" />
</head>
<body>
    <header>
        <h1>ActiveBits Status</h1>
        <div class="sub">Last update: <span id="updated">—</span></div>
        <div class="controls">
            <label class="sub">Refresh:</label>
            <select id="interval">
                <option value="2000">2s</option>
                <option value="5000">5s</option>
                <option value="10000">10s</option>
                <option value="30000">30s</option>
            </select>
            <button id="pauseBtn">Pause</button>
            <button id="resumeBtn" style="display:none">Resume</button>
        </div>
    </header>
    <div class="container">
        <div class="grid">
            <div class="card"><h3>Mode</h3><div class="value" id="mode">-</div><div class="sub">TTL: <span id="ttl">-</span></div></div>
            <div class="card"><h3>Uptime</h3><div class="value" id="uptime">-</div><div class="sub">Node <code>${process.version}</code></div></div>
            <div class="card"><h3>WS Clients</h3><div class="value" id="wsClients">-</div><div class="sub">Connected sockets</div></div>
            <div class="card"><h3>RSS Memory</h3><div class="value" id="rss">-</div><div class="sub">Heap <span id="heap">-</span></div></div>
            <div class="card"><h3>Sessions</h3><div class="value" id="sessionsCount">-</div><div class="sub">Approx size <span id="sessionsBytes">-</span></div></div>
        </div>

        <div class="grid">
            <div class="card"><h3>Sessions by Type</h3><div class="kvs" id="byType"></div></div>
            <div class="card"><h3>Valkey</h3><div class="kvs" id="valkey"></div></div>
        </div>

        <div class="card table-card">
            <h3>Active Sessions</h3>
            <div id="error" class="bad" style="margin-bottom:8px;"></div>
            <table>
                <thead>
                    <tr>
                        <th>Session ID</th>
                        <th>Type</th>
                        <th>Sockets</th>
                        <th>Last Activity</th>
                        <th>Expires At</th>
                        <th>TTL</th>
                        <th>Approx Size</th>
                    </tr>
                </thead>
                <tbody id="sessionsBody"></tbody>
            </table>
        </div>
    </div>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
});

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

// Graceful shutdown handler for hot redeployments
async function shutdown(signal) {
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

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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

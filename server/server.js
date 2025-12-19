import http from "http";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { createSessionStore, setupSessionRoutes } from "./core/sessions.js";
import { createWsRouter } from "./core/wsRouter.js";
import { initializePersistentStorage } from "./core/persistentSessions.js";
import { setupPersistentSessionWs } from "./core/persistentSessionWs.js";
import { getAllowedActivities, isValidActivity, registerActivityRoutes, initializeActivityRegistry } from "./activities/activityRegistry.js";
import { registerStatusRoute } from "./routes/statusRoute.js";
import { registerPersistentSessionRoutes } from "./routes/persistentSessionRoutes.js";

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

const ws = createWsRouter(server, sessions);

setupSessionRoutes(app, sessions, ws.wss);

// Setup persistent session WebSocket handling
setupPersistentSessionWs(ws, sessions);
registerPersistentSessionRoutes({ app, sessions });

// Initialize activity registry (filters out dev-only activities in production)
await initializeActivityRegistry();

// Attach feature-specific route handlers (discover modules dynamically)
await registerActivityRoutes(app, sessions, ws);

// Status endpoint
registerStatusRoute({ app, sessions, ws, sessionTtl, valkeyUrl });
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
    // Reuse a single upstream connection for the many small module requests Vite serves.
    // This significantly reduces waterfall latency from repeated TCP handshakes.
    const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 128, keepAliveMsecs: 30000 });
    const viteProxy = createProxyMiddleware({
        target: "http://127.0.0.1:5173",
        changeOrigin: true,
        ws: true,
        xfwd: true,
        logLevel: "silent",
        agent: keepAliveAgent,
        proxyTimeout: 30000,
        timeout: 30000,
        headers: {
            connection: 'keep-alive',
        },
        // Only proxy Vite assets and HMR path; leave app WS under /ws untouched
        pathFilter: (path) => {
            if (path.startsWith('/api')) return false;
            if (path.startsWith('/ws')) return false; // app WS
            return true; // Vite assets and /vite-hmr
        },
        onProxyReq(proxyReq) {
            // Ensure upstream sees keep-alive, which helps with many 304s
            proxyReq.setHeader('Connection', 'keep-alive');
        },
    });
    app.use(viteProxy);

    // Proxy WebSocket upgrades for Vite HMR
    server.on('upgrade', (req, socket, head) => {
        // Proxy only Vite HMR websocket upgrades
        if (req.url && req.url.startsWith('/vite-hmr')) {
            viteProxy.upgrade?.(req, socket, head);
            return;
        }
        // App-managed websocket routes (e.g., /ws) are handled elsewhere
    });
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
    console.log(`ActiveBits server running on \x1b[1m\x1b[32mhttp://localhost:${PORT}\x1b[0m`);
});

// Graceful shutdown handler for hot redeployments
async function shutdown(signal) {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    const closeWebSockets = () => new Promise((resolve) => {
        if (!ws?.wss) return resolve();
        const clients = Array.from(ws.wss.clients);
        if (clients.length === 0) {
            ws.wss.close(() => resolve());
            return;
        }

        let remaining = clients.length;
        let finalized = false;
        const finalize = () => {
            if (finalized) return;
            finalized = true;
            ws.wss.close(() => resolve());
        };

        const onClientClosed = () => {
            remaining -= 1;
            if (remaining <= 0) finalize();
        };

        clients.forEach((client) => {
            client.once('close', onClientClosed);
            try {
                client.close(1001, 'Server shutting down');
            } catch {
                onClientClosed();
            }
        });

        setTimeout(finalize, 1000);
    });
    const webSocketClosePromise = closeWebSockets();
    
    // Stop accepting new connections
    server.close(async () => {
        console.log('HTTP server closed');

        await webSocketClosePromise;
        
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

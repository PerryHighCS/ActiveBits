import { WebSocketServer } from "ws";
import { findHashBySessionId, resetPersistentSession } from "./persistentSessions.js";

const SESSION_CLEANUP_GRACE_PERIOD_MS = 5_000;

function getClientIp(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor) {
        const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
        const forwardedIp = value.split(",").map(p => p.trim()).find(Boolean);
        if (forwardedIp) return forwardedIp;
    }

    const forwarded = req.headers["forwarded"];
    if (forwarded) {
        const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const match = value.match(/for=([^;]+)/i);
        if (match?.[1]) return match[1].replace(/^\[|\]$/g, "").replace(/"/g, "");
    }

    return req.socket?.remoteAddress || "";
}

/**
 * Creates a WebSocket router for handling connections in all activity modules.
 */
export function createWsRouter(server, sessions) {
    const wss = new WebSocketServer({ noServer: true });
    const namespaces = new Map();
    const sessionCleanupTimers = new Map();

    // Subscribe to session-ended broadcasts if using Valkey
    if (sessions && sessions.subscribeToBroadcast) {
        sessions.subscribeToBroadcast('session-ended', ({ sessionId }) => {
            // Broadcast to local WebSocket clients when session ends
            for (const client of wss.clients) {
                if (typeof client.sessionId !== 'undefined' && client.sessionId === sessionId && client.readyState === 1) {
                    client.send(JSON.stringify({ type: 'session-ended' }));
                }
            }
        });
    }

    const scheduleSessionCleanup = (sessionId) => {
        if (!sessionId || !sessions) return;

        // Clear any existing timer so only the latest one runs
        const existingTimer = sessionCleanupTimers.get(sessionId);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(async () => {
            const hasClients = Array.from(wss.clients).some(
                (client) =>
                    client.readyState === 1 && // OPEN
                    client.sessionId === sessionId
            );

            if (hasClients) return; // Someone reconnected

            const session = await sessions.get(sessionId);
            if (session) {
                try {
                    const hash = await findHashBySessionId(sessionId);
                    if (hash) {
                        await resetPersistentSession(hash);
                    } else {
                        console.warn(`No persistent hash found for session ${sessionId} during cleanup`);
                    }
                } catch (err) {
                    console.error('Failed to reset persistent session during cleanup', err);
                }
                await sessions.delete(sessionId);
                console.log(`Ended session ${sessionId} because no clients remained connected.`);
            }
        }, SESSION_CLEANUP_GRACE_PERIOD_MS); // short grace period for quick reconnects

        sessionCleanupTimers.set(sessionId, timer);
        timer.unref?.();
    };

    server.on("upgrade", (req, socket, head) => {
        try {
            const url = new URL(req.url, "http://x");
            const onConn = namespaces.get(url.pathname);
            if (!onConn) return socket.destroy();
            wss.handleUpgrade(req, socket, head, (ws) => {
                ws.isAlive = true;
                ws.clientIp = getClientIp(req);
                const touch = async () => {
                    if (sessions && ws.sessionId) await sessions.touch(ws.sessionId);
                };
                ws.on("pong", () => {
                    ws.isAlive = true;
                    touch();
                });
                ws.on("ping", () => {
                    ws.isAlive = true;
                    touch();
                });
                onConn(ws, url.searchParams, wss);
                if (sessions && ws.sessionId) touch();
                ws.on("message", () => {
                    touch();
                });
                ws.on("close", () => {
                    if (ws.sessionId) {
                        scheduleSessionCleanup(ws.sessionId);
                    }
                });
            });
        } catch { socket.destroy(); }
    });

    setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) ws.terminate();
            ws.isAlive = false; try { ws.ping(ws.sessionId || ""); } catch { }
        }
    }, 30000).unref?.();

    return {
        wss,
        register: (pathname, handler) => namespaces.set(pathname, handler),
    };
}

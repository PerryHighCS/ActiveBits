import { WebSocketServer } from "ws";

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

    server.on("upgrade", (req, socket, head) => {
        try {
            const url = new URL(req.url, "http://x");
            const onConn = namespaces.get(url.pathname);
            if (!onConn) return socket.destroy();
            wss.handleUpgrade(req, socket, head, (ws) => {
                ws.isAlive = true;
                ws.clientIp = getClientIp(req);
                const touch = () => {
                    if (sessions && ws.sessionId) sessions[ws.sessionId];
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
                if (sessions && ws.sessionId) sessions[ws.sessionId];
                ws.on("message", () => {
                    touch();
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

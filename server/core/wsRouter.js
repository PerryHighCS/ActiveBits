import { WebSocketServer } from "ws";

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
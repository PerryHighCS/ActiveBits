import { WebSocketServer } from "ws";

/**
 * Creates a WebSocket router for handling connections in all activity modules.
 */
export function createWsRouter(server) {
    const wss = new WebSocketServer({ noServer: true });
    const namespaces = new Map();

    server.on("upgrade", (req, socket, head) => {
        try {
            const url = new URL(req.url, "http://x");
            const onConn = namespaces.get(url.pathname);
            if (!onConn) return socket.destroy();
            wss.handleUpgrade(req, socket, head, (ws) => {
                ws.isAlive = true;
                ws.on("pong", () => (ws.isAlive = true));
                onConn(ws, url.searchParams, wss);
            });
        } catch { socket.destroy(); }
    });

    setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) ws.terminate();
            ws.isAlive = false; try { ws.ping(); } catch { }
        }
    }, 30000).unref?.();

    return {
        wss,
        register: (pathname, handler) => namespaces.set(pathname, handler),
    };
}
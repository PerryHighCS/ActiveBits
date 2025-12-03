/**
 * Register the /api/status endpoint.
 * @param {object} options
 * @param {import('express').Express} options.app
 * @param {object} options.sessions
 * @param {object} options.ws
 * @param {number} options.sessionTtl
 * @param {string|null} options.valkeyUrl
 */
export function registerStatusRoute({ app, sessions, ws, sessionTtl, valkeyUrl }) {
    app.get("/api/status", async (req, res) => {
        try {
            const allSessions = await sessions.getAll();
            const exposeSessionIds = process.env.NODE_ENV !== 'production';
            
            // Group sessions by type
            const byType = {};
            let approxTotalBytes = 0;
            
            let pttlValues = null;
            if (sessions.valkeyStore && allSessions.length > 0) {
                try {
                    pttlValues = await Promise.all(
                        allSessions.map((session) =>
                            sessions.valkeyStore.client.pttl(`session:${session.id}`).catch((err) => {
                                console.error(`Failed to get TTL for session ${session.id}:`, err);
                                return -1;
                            })
                        )
                    );
                } catch (err) {
                    console.error('Failed to batch fetch session TTLs:', err);
                    pttlValues = null;
                }
            }
        
            const sessionList = await Promise.all(allSessions.map(async (session, index) => {
                const type = session.type || 'unknown';
                byType[type] = (byType[type] || 0) + 1;
            
            // Approximate session size
            const approxBytes = JSON.stringify(session).length;
            approxTotalBytes += approxBytes;
        
            // Count connected WebSocket clients for this session
            let socketCount = 0;
            for (const client of ws.wss.clients) {
                if (client.sessionId === session.id && client.readyState === 1) {
                    socketCount++;
                }
            }
        
            // Calculate TTL
            let ttlRemainingMs = null;
            let expiresAt = null;
        
            if (sessions.valkeyStore) {
                const pttl = pttlValues ? pttlValues[index] : -1;
                ttlRemainingMs = pttl > 0 ? pttl : 0;
                if (ttlRemainingMs > 0) {
                    expiresAt = new Date(Date.now() + ttlRemainingMs).toISOString();
                }
            } else {
                // In-memory mode: derive from lastActivity
                const lastActivity = session.lastActivity || session.created || Date.now();
                const ttlMs = sessions.ttlMs || sessionTtl;
                ttlRemainingMs = Math.max(0, (lastActivity + ttlMs) - Date.now());
                if (ttlRemainingMs > 0) {
                    expiresAt = new Date(lastActivity + ttlMs).toISOString();
                }
            }
        
            const info = {
                type,
                created: session.created ? new Date(session.created).toISOString() : null,
                lastActivity: session.lastActivity ? new Date(session.lastActivity).toISOString() : null,
                ttlRemainingMs,
                expiresAt,
                socketCount,
                approxBytes,
            };
            if (exposeSessionIds) {
                info.id = session.id;
            }
            return info;
        }));
            
            // Valkey info (if available)
            let valkeyInfo = null;
            if (sessions.valkeyStore) {
                try {
                    const ping = await sessions.valkeyStore.client.ping();
                    const dbsize = await sessions.valkeyStore.client.dbsize();
                    const memoryInfo = await sessions.valkeyStore.client.call('INFO', 'memory');
                    
                    // Parse memory info
                    const memoryLines = memoryInfo.split('\r\n');
                    const memory = {};
                    for (const line of memoryLines) {
                        if (line.includes(':')) {
                            const [key, value] = line.split(':');
                            if (key.startsWith('used_memory')) {
                                memory[key] = value;
                            }
                        }
                    }
                    
                    valkeyInfo = { ping, dbsize, memory };
                } catch (err) {
                    valkeyInfo = { error: err.message };
                }
            }
            
            const status = {
                storage: {
                    mode: sessions.valkeyStore ? 'valkey' : 'in-memory',
                    ttlMs: sessions.valkeyStore ? sessions.valkeyStore.ttlMs : sessionTtl,
                    valkeyUrl: valkeyUrl ? '***masked***' : null,
                },
                process: {
                    pid: process.pid,
                    node: process.version,
                    uptimeSeconds: Math.floor(process.uptime()),
                    memory: process.memoryUsage(),
                    loadavg: typeof process.loadavg === 'function' ? process.loadavg() : null,
                },
                websocket: {
                    connectedClients: ws.wss.clients.size,
                },
                sessions: {
                    count: allSessions.length,
                    approxTotalBytes,
                    byType,
                    list: sessionList,
                    showSessionIds: exposeSessionIds,
                },
                valkey: valkeyInfo,
            };
            
            res.json(status);
        } catch (err) {
            console.error('Error in /api/status:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

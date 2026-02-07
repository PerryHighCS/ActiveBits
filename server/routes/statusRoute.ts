import os from 'node:os'

interface SessionRecordLike {
  id: string
  type?: string
  created?: number
  lastActivity?: number
  [key: string]: unknown
}

interface ValkeyClientLike {
  pttl(key: string): Promise<number>
  ping(): Promise<string>
  dbsize(): Promise<number>
  call(command: string, section: string): Promise<string>
}

interface SessionsLike {
  getAll(): Promise<SessionRecordLike[]>
  ttlMs?: number
  valkeyStore?: {
    ttlMs?: number
    client: ValkeyClientLike
  }
}

interface WsClientLike {
  sessionId?: string | null
  readyState: number
}

interface WsLike {
  wss: {
    clients: Iterable<WsClientLike> & { size?: number }
  }
}

interface ResponseLike {
  status(code: number): ResponseLike
  json(payload: unknown): void
}

interface AppLike {
  get(path: string, handler: (_req: unknown, res: ResponseLike) => void | Promise<void>): void
}

interface RegisterStatusRouteOptions {
  app: AppLike
  sessions: SessionsLike
  ws: WsLike
  sessionTtl: number
  valkeyUrl: string | null
}

interface SessionStatusInfo {
  id?: string
  type: string
  created: string | null
  lastActivity: string | null
  ttlRemainingMs: number
  expiresAt: string | null
  socketCount: number
  approxBytes: number
}

function getWsClientCount(ws: WsLike): number {
  if (typeof ws.wss.clients.size === 'number') {
    return ws.wss.clients.size
  }
  return Array.from(ws.wss.clients).length
}

/**
 * Register the /api/status endpoint.
 */
export function registerStatusRoute({ app, sessions, ws, sessionTtl, valkeyUrl }: RegisterStatusRouteOptions): void {
  app.get('/api/status', async (_req, res) => {
    try {
      const allSessions = await sessions.getAll()
      const exposeSessionIds = process.env.NODE_ENV !== 'production'

      const byType: Record<string, number> = {}
      let approxTotalBytes = 0

      let pttlValues: number[] | null = null
      if (sessions.valkeyStore && allSessions.length > 0) {
        try {
          pttlValues = await Promise.all(
            allSessions.map((session) =>
              sessions.valkeyStore!.client.pttl(`session:${session.id}`).catch((err: unknown) => {
                console.error(`Failed to get TTL for session ${session.id}:`, err)
                return -1
              }),
            ),
          )
        } catch (err) {
          console.error('Failed to batch fetch session TTLs:', err)
          pttlValues = null
        }
      }

      const sessionList = await Promise.all(
        allSessions.map(async (session, index): Promise<SessionStatusInfo> => {
          const type = typeof session.type === 'string' && session.type ? session.type : 'unknown'
          byType[type] = (byType[type] || 0) + 1

          const approxBytes = JSON.stringify(session).length
          approxTotalBytes += approxBytes

          let socketCount = 0
          for (const client of ws.wss.clients) {
            if (client.sessionId === session.id && client.readyState === 1) {
              socketCount += 1
            }
          }

          let ttlRemainingMs = 0
          let expiresAt: string | null = null

          if (sessions.valkeyStore) {
            const pttl = pttlValues?.[index]
            ttlRemainingMs = typeof pttl === 'number' && pttl > 0 ? pttl : 0
            if (ttlRemainingMs > 0) {
              expiresAt = new Date(Date.now() + ttlRemainingMs).toISOString()
            }
          } else {
            const lastActivity =
              typeof session.lastActivity === 'number'
                ? session.lastActivity
                : typeof session.created === 'number'
                  ? session.created
                  : Date.now()
            const ttlMs = typeof sessions.ttlMs === 'number' ? sessions.ttlMs : sessionTtl
            ttlRemainingMs = Math.max(0, lastActivity + ttlMs - Date.now())
            if (ttlRemainingMs > 0) {
              expiresAt = new Date(lastActivity + ttlMs).toISOString()
            }
          }

          const info: SessionStatusInfo = {
            type,
            created: typeof session.created === 'number' ? new Date(session.created).toISOString() : null,
            lastActivity: typeof session.lastActivity === 'number' ? new Date(session.lastActivity).toISOString() : null,
            ttlRemainingMs,
            expiresAt,
            socketCount,
            approxBytes,
          }
          if (exposeSessionIds) {
            info.id = session.id
          }
          return info
        }),
      )

      let valkeyInfo: { ping?: string; dbsize?: number; memory?: Record<string, string>; error?: string } | null = null
      if (sessions.valkeyStore) {
        try {
          const ping = await sessions.valkeyStore.client.ping()
          const dbsize = await sessions.valkeyStore.client.dbsize()
          const memoryInfo = await sessions.valkeyStore.client.call('INFO', 'memory')

          const memoryLines = memoryInfo.split('\r\n')
          const memory: Record<string, string> = {}
          for (const line of memoryLines) {
            if (!line.includes(':')) continue
            const [key, value] = line.split(':')
            if (key?.startsWith('used_memory') && typeof value === 'string') {
              memory[key] = value
            }
          }

          valkeyInfo = { ping, dbsize, memory }
        } catch (err) {
          valkeyInfo = { error: err instanceof Error ? err.message : String(err) }
        }
      }

      res.json({
        environment: {
          nodeEnv: process.env.NODE_ENV || 'development',
          isDevelopment: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev',
        },
        storage: {
          mode: sessions.valkeyStore ? 'valkey' : 'in-memory',
          ttlMs: sessions.valkeyStore ? (sessions.valkeyStore.ttlMs ?? sessionTtl) : sessionTtl,
          valkeyUrl: valkeyUrl ? '***masked***' : null,
        },
        process: {
          pid: process.pid,
          node: process.version,
          uptimeSeconds: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          loadavg: os.loadavg(),
        },
        websocket: {
          connectedClients: getWsClientCount(ws),
        },
        sessions: {
          count: allSessions.length,
          approxTotalBytes,
          byType,
          list: sessionList,
          showSessionIds: exposeSessionIds,
        },
        valkey: valkeyInfo,
      })
    } catch (err) {
      console.error('Error in /api/status:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}

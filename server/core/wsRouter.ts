import { WebSocketServer } from 'ws'
import type { ActiveBitsWebSocket, WsConnectionHandler, WsRouter } from '../../types/websocket.js'

const SESSION_CLEANUP_GRACE_PERIOD_MS = 5_000
const WS_OPEN_READY_STATE = 1

interface UpgradeRequest {
  url?: string | null
  headers: Record<string, string | string[] | undefined>
  socket?: {
    remoteAddress?: string
  }
}

interface SessionStore {
  get?(id: string): Promise<unknown>
  touch?(id: string): Promise<boolean>
  subscribeToBroadcast?(channel: string, handler: (message: unknown) => void): void
}

interface UpgradeCapableServer {
  on(event: 'upgrade', handler: (req: UpgradeRequest, socket: { destroy(): void }, head: Buffer) => void): void
}

function getClientIp(req: UpgradeRequest): string {
  const forwardedFor = req.headers['x-forwarded-for']
  if (forwardedFor != null) {
    const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
    if (!value) {
      return req.socket?.remoteAddress || ''
    }
    const forwardedIp = value
      .split(',')
      .map((part) => part.trim())
      .find(Boolean)
    if (forwardedIp) return forwardedIp
  }

  const forwarded = req.headers.forwarded
  if (forwarded != null) {
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (!value) {
      return req.socket?.remoteAddress || ''
    }
    const match = value.match(/for=([^;]+)/i)
    if (match?.[1]) {
      return match[1].replace(/^\[|\]$/g, '').replace(/"/g, '')
    }
  }

  return req.socket?.remoteAddress || ''
}

/**
 * Creates a WebSocket router for handling connections in all activity modules.
 */
export function createWsRouter(server: UpgradeCapableServer, sessions: SessionStore): WsRouter {
  const wss = new WebSocketServer({ noServer: true }) as unknown as WsRouter['wss'] & {
    handleUpgrade(
      req: UpgradeRequest,
      socket: { destroy(): void },
      head: Buffer,
      callback: (ws: ActiveBitsWebSocket) => void,
    ): void
  }

  const namespaces = new Map<string, WsConnectionHandler>()
  const sessionCleanupTimers = new Map<string, NodeJS.Timeout>()

  if (sessions?.subscribeToBroadcast) {
    sessions.subscribeToBroadcast('session-ended', (message: unknown) => {
      const sessionId =
        message != null && typeof message === 'object' && 'sessionId' in message
          ? (message as { sessionId?: string | null }).sessionId
          : undefined
      for (const client of wss.clients) {
        if (
          typeof client.sessionId !== 'undefined' &&
          client.sessionId === sessionId &&
          client.readyState === WS_OPEN_READY_STATE
        ) {
          client.send(JSON.stringify({ type: 'session-ended' }))
        }
      }
    })
  }

  const scheduleSessionCleanup = (sessionId: string): void => {
    if (sessionId == null || sessions == null) return

    const existingTimer = sessionCleanupTimers.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const hasClients = Array.from(wss.clients).some(
            (client) => client.readyState === WS_OPEN_READY_STATE && client.sessionId === sessionId,
          )

          if (!hasClients) {
            if (sessions?.get) {
              try {
                const sessionExists = Boolean(await sessions.get(sessionId))
                if (sessionExists) {
                  console.log(
                    `No clients remain connected to session ${sessionId}; preserving data until TTL or manual deletion.`,
                  )
                } else {
                  console.log(`Session ${sessionId} ended and no clients remain connected.`)
                }
              } catch (err) {
                console.error(`Failed to check session ${sessionId} existence during cleanup:`, err)
                console.log(`No clients remain connected to session ${sessionId}; session status unknown.`)
              }
            } else {
              console.warn(
                `Session store implementation is missing required get() method; cannot check session existence for cleanup of session ${sessionId}.`,
              )
            }
          }

          sessionCleanupTimers.delete(sessionId)
        } catch (err) {
          console.error(`Unexpected error during session ${sessionId} cleanup:`, err)
          sessionCleanupTimers.delete(sessionId)
        }
      })()
    }, SESSION_CLEANUP_GRACE_PERIOD_MS)

    sessionCleanupTimers.set(sessionId, timer)
    timer.unref?.()
  }

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '', 'http://x')
      const onConnection = namespaces.get(url.pathname)
      if (!onConnection) {
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.isAlive = true
        ws.clientIp = getClientIp(req)
        ws.upgradeHeaders = req.headers

        const touch = async (): Promise<void> => {
          if (sessions?.touch == null || ws.sessionId == null) return

          try {
            await sessions.touch(ws.sessionId)
          } catch (error) {
            console.error(`Failed to refresh activity for session ${ws.sessionId}:`, error)
          }
        }

        ws.on('pong', () => {
          ws.isAlive = true
          void touch()
        })

        ws.on('ping', () => {
          ws.isAlive = true
          void touch()
        })

        onConnection(ws, url.searchParams, wss)

        if (sessions?.touch && ws.sessionId) {
          void touch()
        }

        ws.on('message', () => {
          void touch()
        })

        ws.on('close', () => {
          if (ws.sessionId) {
            scheduleSessionCleanup(ws.sessionId)
          }
        })
      })
    } catch {
      socket.destroy()
    }
  })

  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      try {
        ws.ping(ws.sessionId || '')
      } catch {
        // Ignore ping errors on closed/invalid sockets
      }
    }
  }, 30_000).unref?.()

  return {
    wss,
    register: (pathname: string, handler: WsConnectionHandler) => namespaces.set(pathname, handler),
  }
}

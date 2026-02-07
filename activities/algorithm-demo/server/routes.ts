import type { Request, Response } from 'express'
import { createSession } from 'activebits-server/core/sessions.js'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'

interface AlgorithmDemoSessionData extends Record<string, unknown> {
  algorithmId: string | null
  algorithmState: Record<string, unknown>
  history: Array<Record<string, unknown>>
}

interface WsClientLike {
  readyState: number
  sessionId?: string | null
  send(payload: string): void
}

interface WsRouterLike {
  register(path: string, handler: (socket: WsClientLike, qp: URLSearchParams) => void): void
  wss: {
    clients: Iterable<WsClientLike>
  }
}

interface AppLike {
  post(path: string, handler: (req: Request, res: Response) => Promise<void>): void
  get(path: string, handler: (req: Request, res: Response) => Promise<void>): void
}

interface AlgorithmDemoSessionStore extends Pick<SessionStore, 'get' | 'set'> {
  publishBroadcast?: (channel: string, message: Record<string, unknown>) => Promise<void>
  subscribeToBroadcast?: (channel: string, handler: (message: unknown) => void) => void
}

interface SelectRequestBody {
  algorithmId?: string | null
  algorithmState?: Record<string, unknown>
}

interface StateRequestBody {
  algorithmState?: Record<string, unknown>
}

interface EventRequestBody {
  eventType?: string
  payload?: unknown
}

function readSessionId(req: Request): string | null {
  return typeof req.params.sessionId === 'string' && req.params.sessionId.length > 0
    ? req.params.sessionId
    : null
}

function getSessionData(session: SessionRecord): AlgorithmDemoSessionData {
  const rawData = session.data && typeof session.data === 'object' ? session.data : {}
  const data = rawData as Record<string, unknown>
  const history = Array.isArray(data.history)
    ? data.history.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
      )
    : []

  const normalized: AlgorithmDemoSessionData = {
    ...data,
    algorithmId: typeof data.algorithmId === 'string' ? data.algorithmId : null,
    algorithmState:
      data.algorithmState && typeof data.algorithmState === 'object'
        ? (data.algorithmState as Record<string, unknown>)
        : {},
    history,
  }

  session.data = normalized
  return normalized
}

/**
 * Register session normalizer for algorithm-demo
 * Ensures loaded sessions have required data structures
 */
registerSessionNormalizer('algorithm-demo', (session) => {
  getSessionData(session as SessionRecord)
})

export default function setupAlgorithmDemoRoutes(
  app: AppLike,
  sessions: AlgorithmDemoSessionStore,
  ws: WsRouterLike,
): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  ws.register('/ws/algorithm-demo', (socket, qp) => {
    socket.sessionId = qp.get('sessionId') || null
    if (socket.sessionId) {
      ensureBroadcastSubscription(socket.sessionId)
    }
  })

  async function broadcast(
    type: string,
    payload: unknown,
    sessionId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const msgObj = { type, payload, timestamp: Date.now(), ...metadata }
    const msg = JSON.stringify(msgObj)
    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, msgObj)
    }

    for (const client of ws.wss.clients) {
      if (client.readyState === 1 && client.sessionId === sessionId) {
        try {
          client.send(msg)
        } catch {
          // ignore send errors
        }
      }
    }
  }

  app.post('/api/algorithm-demo/create', async (_req, res) => {
    try {
      const session = await createSession(sessions, { data: {} })
      session.type = 'algorithm-demo'
      const data = getSessionData(session)
      data.algorithmId = null
      data.algorithmState = {}
      data.history = []
      await sessions.set(session.id, session)
      res.json({ id: session.id })
      return
    } catch (err) {
      console.error('Error creating algorithm-demo session:', err)
      res.status(500).json({ error: 'Failed to create session' })
      return
    }
  })

  app.get('/api/algorithm-demo/:sessionId/session', async (req, res) => {
    try {
      const sessionId = readSessionId(req)
      if (!sessionId) {
        res.status(400).json({ error: 'Session id required' })
        return
      }

      const session = await sessions.get(sessionId)
      if (!session || session.type !== 'algorithm-demo') {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json(session)
      return
    } catch (err) {
      console.error('Error fetching session:', err)
      res.status(500).json({ error: 'Failed to fetch session' })
      return
    }
  })

  app.post('/api/algorithm-demo/:sessionId/select', async (req, res) => {
    try {
      const sessionId = readSessionId(req)
      if (!sessionId) {
        res.status(400).json({ error: 'Session id required' })
        return
      }

      const session = await sessions.get(sessionId)
      if (!session || session.type !== 'algorithm-demo') {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      const { algorithmId, algorithmState } = (req.body ?? {}) as SelectRequestBody
      const data = getSessionData(session)
      data.algorithmId = typeof algorithmId === 'string' ? algorithmId : null
      data.algorithmState = algorithmState ?? {}
      data.history.push({
        action: 'algorithm-selected',
        algorithmId: data.algorithmId,
        timestamp: Date.now(),
      })

      await sessions.set(session.id, session)
      await broadcast('algorithm-selected', data.algorithmState, session.id, {
        algorithmId: data.algorithmId,
      })

      res.json({ success: true })
      return
    } catch (err) {
      console.error('Error selecting algorithm:', err)
      res.status(500).json({ error: 'Failed to select algorithm' })
      return
    }
  })

  app.post('/api/algorithm-demo/:sessionId/state', async (req, res) => {
    try {
      const sessionId = readSessionId(req)
      if (!sessionId) {
        res.status(400).json({ error: 'Session id required' })
        return
      }

      const session = await sessions.get(sessionId)
      if (!session || session.type !== 'algorithm-demo') {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      const { algorithmState } = (req.body ?? {}) as StateRequestBody
      const data = getSessionData(session)
      data.algorithmState = algorithmState ?? {}
      data.history.push({
        action: 'state-update',
        timestamp: Date.now(),
        stateKeys: Object.keys(data.algorithmState),
      })

      await sessions.set(session.id, session)
      await broadcast('state-sync', data.algorithmState, session.id)

      res.json({ success: true })
      return
    } catch (err) {
      console.error('Error updating state:', err)
      res.status(500).json({ error: 'Failed to update state' })
      return
    }
  })

  app.post('/api/algorithm-demo/:sessionId/event', async (req, res) => {
    try {
      const sessionId = readSessionId(req)
      if (!sessionId) {
        res.status(400).json({ error: 'Session id required' })
        return
      }

      const session = await sessions.get(sessionId)
      if (!session || session.type !== 'algorithm-demo') {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      const { eventType, payload } = (req.body ?? {}) as EventRequestBody
      const data = getSessionData(session)
      data.history.push({
        action: 'event',
        eventType,
        timestamp: Date.now(),
      })

      await sessions.set(session.id, session)
      await broadcast('event', { type: eventType, payload }, session.id)

      res.json({ success: true })
      return
    } catch (err) {
      console.error('Error publishing event:', err)
      res.status(500).json({ error: 'Failed to publish event' })
      return
    }
  })
}

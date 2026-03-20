import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  InstructorAnnotation,
  Question,
  QuestionReveal,
  Response,
  Student,
} from '../shared/types.js'

// ---------------------------------------------------------------------------
// Route-level types
// ---------------------------------------------------------------------------

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
  headers?: Record<string, string | undefined>
}

interface ResonanceRouteApp {
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface ResonanceSocket extends ActiveBitsWebSocket {
  sessionId?: string | null
  isInstructor?: boolean
  studentId?: string | null
}

// ---------------------------------------------------------------------------
// Session data shape
// ---------------------------------------------------------------------------

interface ResonanceSessionData extends Record<string, unknown> {
  instructorPasscode: string
  questions: Question[]
  activeQuestionId: string | null
  students: Record<string, Student>
  responses: Response[]
  annotations: Record<string, InstructorAnnotation>
  reveals: QuestionReveal[]
  responseOrderOverrides: Record<string, string[]>
}

interface ResonanceSession extends SessionRecord {
  type?: string
  data: ResonanceSessionData
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function normalizeSessionData(data: unknown): ResonanceSessionData {
  const source = ensurePlainObject(data)
  return {
    instructorPasscode: typeof source.instructorPasscode === 'string' ? source.instructorPasscode : '',
    questions: Array.isArray(source.questions) ? (source.questions as Question[]) : [],
    activeQuestionId: typeof source.activeQuestionId === 'string' ? source.activeQuestionId : null,
    students: isPlainObject(source.students) ? (source.students as Record<string, Student>) : {},
    responses: Array.isArray(source.responses) ? (source.responses as Response[]) : [],
    annotations: isPlainObject(source.annotations)
      ? (source.annotations as Record<string, InstructorAnnotation>)
      : {},
    reveals: Array.isArray(source.reveals) ? (source.reveals as QuestionReveal[]) : [],
    responseOrderOverrides: isPlainObject(source.responseOrderOverrides)
      ? (source.responseOrderOverrides as Record<string, string[]>)
      : {},
  }
}

function asResonanceSession(session: SessionRecord | null): ResonanceSession | null {
  if (!session || session.type !== 'resonance') return null
  session.data = normalizeSessionData(session.data)
  return session as ResonanceSession
}

function generatePasscode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

// ---------------------------------------------------------------------------
// Session normalizer registration
// ---------------------------------------------------------------------------

registerSessionNormalizer('resonance', (session) => {
  session.data = normalizeSessionData(session.data)
})

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export default function setupResonanceRoutes(
  app: ResonanceRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
): void {
  async function broadcast(type: string, payload: unknown, sessionId: string): Promise<void> {
    const message = JSON.stringify({ type, payload })
    const clients = ws.wss.clients ?? new Set<ActiveBitsWebSocket>()
    for (const socket of clients as Set<ResonanceSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(message)
        } catch (err) {
          console.error('[resonance] Failed to send broadcast', { sessionId, err })
        }
      }
    }
  }

  // POST /api/resonance/create
  app.post('/api/resonance/create', async (_req, res) => {
    const instructorPasscode = generatePasscode()
    const session = await createSession(sessions, {
      data: normalizeSessionData({ instructorPasscode }),
    })
    session.type = 'resonance'
    await sessions.set(session.id, session)
    console.info('[resonance] Session created', { sessionId: session.id })
    res.json({ id: session.id, instructorPasscode })
  })

  // POST /api/resonance/generate-link — stub; full implementation in Phase 3
  app.post('/api/resonance/generate-link', async (_req, res) => {
    res.status(501).json({ error: 'generate-link not yet implemented' })
  })

  // POST /api/resonance/:sessionId/register-student — stub; full implementation in Phase 4
  app.post('/api/resonance/:sessionId/register-student', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }
    const session = asResonanceSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }
    res.status(501).json({ error: 'register-student not yet implemented' })
  })

  // GET /api/resonance/:sessionId/instructor-passcode — stub; full implementation in Phase 3
  app.get('/api/resonance/:sessionId/instructor-passcode', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }
    const session = asResonanceSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }
    res.status(501).json({ error: 'instructor-passcode recovery not yet implemented' })
  })

  // GET /api/resonance/:sessionId/state
  app.get('/api/resonance/:sessionId/state', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }
    const session = asResonanceSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }
    const { activeQuestionId, questions, reveals } = session.data
    res.json({ sessionId, activeQuestionId, questions, reveals })
  })

  // GET /api/resonance/:sessionId/responses — stub; full implementation in Phase 5
  app.get('/api/resonance/:sessionId/responses', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }
    const session = asResonanceSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }
    res.status(501).json({ error: 'responses endpoint not yet implemented' })
  })

  // GET /api/resonance/:sessionId/report — stub; full implementation in Phase 8
  app.get('/api/resonance/:sessionId/report', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }
    const session = asResonanceSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }
    res.status(501).json({ error: 'report not yet implemented' })
  })

  // WebSocket /ws/resonance — stub; full implementation in Phase 7
  ws.register('/ws/resonance', (socket, queryParams) => {
    const client = socket as ResonanceSocket
    client.sessionId = queryParams.get('sessionId') || null
    client.isInstructor = false
    client.studentId = queryParams.get('studentId') || null

    const sessionId = client.sessionId
    if (!sessionId) {
      socket.close(1008, 'missing sessionId')
      return
    }

    void (async () => {
      const session = asResonanceSession(await sessions.get(sessionId))
      if (!session) {
        socket.close(1008, 'invalid session')
        return
      }

      const role = queryParams.get('role')
      const instructorPasscode = queryParams.get('instructorPasscode')

      if (role === 'instructor') {
        if (!instructorPasscode || instructorPasscode !== session.data.instructorPasscode) {
          socket.close(1008, 'invalid instructor passcode')
          return
        }
        client.isInstructor = true
      }

      console.info('[resonance] WebSocket connected', {
        sessionId,
        role: client.isInstructor ? 'instructor' : 'student',
      })

      socket.on('message', (...args: unknown[]) => {
        const [rawMessage] = args
        try {
          const data = JSON.parse(String(rawMessage)) as { type?: unknown; payload?: unknown }
          console.info('[resonance] WebSocket message received', {
            sessionId,
            type: data.type,
          })
          // Full message dispatch implemented in Phase 7
        } catch {
          console.warn('[resonance] Failed to parse WebSocket message', { sessionId })
        }
      })

      socket.on('close', () => {
        console.info('[resonance] WebSocket disconnected', {
          sessionId,
          role: client.isInstructor ? 'instructor' : 'student',
        })
      })
    })()
  })

  void broadcast
}

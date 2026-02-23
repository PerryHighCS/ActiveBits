import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { randomBytes } from 'node:crypto'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface SyncDeckRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface SyncDeckInstructorState {
  indices: { h: number; v: number; f: number } | null
  paused: boolean
  overview: boolean
  updatedAt: number
}

interface SyncDeckStudent {
  studentId: string
  name: string
  joinedAt: number
  lastSeenAt: number
  lastIndices: { h: number; v: number; f: number } | null
  lastStudentStateAt: number | null
}

interface SyncDeckEmbeddedActivity {
  embeddedId: string
  activityType: string
  sessionId: string | null
  slideIndex: { h: number; v: number } | null
  displayName: string
  createdAt: number
  status: 'planned' | 'active' | 'ended'
  startedAt: number | null
  endedAt: number | null
}

interface SyncDeckSessionData extends Record<string, unknown> {
  presentationUrl: string | null
  instructorPasscode: string
  instructorState: SyncDeckInstructorState | null
  students: SyncDeckStudent[]
  embeddedActivities: SyncDeckEmbeddedActivity[]
}

interface SyncDeckSession extends SessionRecord {
  type?: string
  data: SyncDeckSessionData
}

interface SyncDeckSocket extends ActiveBitsWebSocket {
  isInstructor?: boolean
  sessionId?: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createInstructorPasscode(): string {
  return randomBytes(16).toString('hex')
}

function normalizeSessionData(data: unknown): SyncDeckSessionData {
  const source = isPlainObject(data) ? data : {}

  return {
    presentationUrl: typeof source.presentationUrl === 'string' ? source.presentationUrl : null,
    instructorPasscode:
      typeof source.instructorPasscode === 'string' && source.instructorPasscode.length > 0
        ? source.instructorPasscode
        : createInstructorPasscode(),
    instructorState: null,
    students: Array.isArray(source.students) ? (source.students as SyncDeckStudent[]) : [],
    embeddedActivities: Array.isArray(source.embeddedActivities)
      ? (source.embeddedActivities as SyncDeckEmbeddedActivity[])
      : [],
  }
}

function asSyncDeckSession(session: SessionRecord | null): SyncDeckSession | null {
  if (!session || session.type !== 'syncdeck') {
    return null
  }

  session.data = normalizeSessionData(session.data)
  return session as SyncDeckSession
}

function readStringField(payload: unknown, key: string): string | null {
  if (!isPlainObject(payload)) return null
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

registerSessionNormalizer('syncdeck', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupSyncDeckRoutes(app: SyncDeckRouteApp, sessions: SessionStore, ws: WsRouter): void {
  app.post('/api/syncdeck/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'syncdeck'
    session.data = normalizeSessionData(session.data)
    await sessions.set(session.id, session)

    const response = res as unknown as JsonResponse
    response.json({ id: session.id, instructorPasscode: session.data.instructorPasscode })
  })

  app.post('/api/syncdeck/:sessionId/configure', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asSyncDeckSession(await sessions.get(sessionId))
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const presentationUrl = readStringField(req.body, 'presentationUrl')
    const instructorPasscode = readStringField(req.body, 'instructorPasscode')
    if (!presentationUrl || !instructorPasscode || instructorPasscode !== session.data.instructorPasscode) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'invalid payload' })
      return
    }

    session.data.presentationUrl = presentationUrl
    await sessions.set(session.id, session)

    const response = res as unknown as JsonResponse
    response.json({ ok: true })
  })

  ws.register('/ws/syncdeck', (socket, query) => {
    const client = socket as SyncDeckSocket
    client.sessionId = query.get('sessionId')
    client.isInstructor = false

    socket.on('message', () => {
      return
    })
  })
}

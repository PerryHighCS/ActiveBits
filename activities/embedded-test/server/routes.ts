import { generateParticipantId } from 'activebits-server/core/participantIds.js'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { connectAcceptedSessionParticipant } from 'activebits-server/core/acceptedSessionParticipants.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'

interface EmbeddedTestParticipant {
  studentId: string
  name: string
  joinedAt: number
  lastSeenAt: number
}

interface EmbeddedTestMessage {
  id: string
  senderRole: 'manager' | 'student'
  senderId: string
  senderName: string
  text: string
  sentAt: number
}

interface EmbeddedTestSessionData extends Record<string, unknown> {
  students: EmbeddedTestParticipant[]
  messages: EmbeddedTestMessage[]
}

interface EmbeddedTestSession extends SessionRecord {
  data: EmbeddedTestSessionData
}

interface EmbeddedTestSocket extends ActiveBitsWebSocket {
  sessionId?: string | null
  studentId?: string | null
  isInstructor?: boolean
}

interface RouteRequest {
  params: Record<string, string | undefined>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface EmbeddedTestRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

const WS_OPEN_READY_STATE = 1
const MAX_MESSAGES = 100

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeParticipantName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Student'
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 80) : 'Student'
}

function normalizeOptionalParticipantName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  return normalizeParticipantName(trimmed)
}

function normalizeParticipantId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 120) : null
}

function normalizeMessageText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null
}

function normalizeStudents(value: unknown): EmbeddedTestParticipant[] {
  if (!Array.isArray(value)) {
    return []
  }

  const participants: EmbeddedTestParticipant[] = []
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue
    }

    const studentId = normalizeParticipantId(entry.studentId)
    if (!studentId) {
      continue
    }

    participants.push({
      studentId,
      name: normalizeParticipantName(entry.name),
      joinedAt: typeof entry.joinedAt === 'number' && Number.isFinite(entry.joinedAt) ? entry.joinedAt : Date.now(),
      lastSeenAt: typeof entry.lastSeenAt === 'number' && Number.isFinite(entry.lastSeenAt) ? entry.lastSeenAt : Date.now(),
    })
  }

  return participants
}

function normalizeMessages(value: unknown): EmbeddedTestMessage[] {
  if (!Array.isArray(value)) {
    return []
  }

  const messages: EmbeddedTestMessage[] = []
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue
    }
    const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : null
    const text = normalizeMessageText(entry.text)
    if (!id || !text) {
      continue
    }

    messages.push({
      id,
      senderRole: entry.senderRole === 'manager' ? 'manager' : 'student',
      senderId: typeof entry.senderId === 'string' && entry.senderId.trim().length > 0 ? entry.senderId.trim() : 'unknown',
      senderName: normalizeParticipantName(entry.senderName),
      text,
      sentAt: typeof entry.sentAt === 'number' && Number.isFinite(entry.sentAt) ? entry.sentAt : Date.now(),
    })
  }

  return messages.slice(-MAX_MESSAGES)
}

function getSessionData(session: SessionRecord): EmbeddedTestSessionData {
  const raw = isPlainObject(session.data) ? session.data : {}
  const normalized: EmbeddedTestSessionData = {
    ...raw,
    students: normalizeStudents(raw.students),
    messages: normalizeMessages(raw.messages),
  }
  session.data = normalized
  return normalized
}

registerSessionNormalizer('embedded-test', (session) => {
  getSessionData(session as SessionRecord)
})

function asEmbeddedTestSession(session: SessionRecord | null): EmbeddedTestSession | null {
  if (!session || session.type !== 'embedded-test') {
    return null
  }

  getSessionData(session)
  return session as EmbeddedTestSession
}

function createMessageId(): string {
  return generateParticipantId()
}

function parseWsMessage(raw: unknown): { type?: unknown; text?: unknown } | null {
  try {
    const text = typeof raw === 'string' ? raw : Buffer.from(raw as ArrayBuffer).toString('utf8')
    const parsed = JSON.parse(text) as unknown
    return isPlainObject(parsed) ? parsed as { type?: unknown; text?: unknown } : null
  } catch {
    return null
  }
}

function sendPayload(socket: ActiveBitsWebSocket, payload: unknown): void {
  if (socket.readyState !== WS_OPEN_READY_STATE) {
    return
  }

  socket.send(JSON.stringify({ type: 'embedded-test', payload }))
}

export default function setupEmbeddedTestRoutes(app: EmbeddedTestRouteApp, sessions: SessionStore, ws: WsRouter): void {
  const broadcastState = async (sessionId: string): Promise<void> => {
    const session = asEmbeddedTestSession(await sessions.get(sessionId))
    if (!session) {
      return
    }

    const connectedStudentIds = new Set<string>()
    for (const client of ws.wss.clients as Set<EmbeddedTestSocket>) {
      if (
        client.readyState === WS_OPEN_READY_STATE &&
        client.sessionId === session.id &&
        client.isInstructor !== true &&
        typeof client.studentId === 'string'
      ) {
        connectedStudentIds.add(client.studentId)
      }
    }

    const payload = {
      type: 'embedded-test-state',
      participants: session.data.students.map((student) => ({
        ...student,
        connected: connectedStudentIds.has(student.studentId),
      })),
      messages: session.data.messages,
      connectedCount: connectedStudentIds.size,
    }

    for (const client of ws.wss.clients as Set<EmbeddedTestSocket>) {
      if (client.sessionId !== session.id) {
        continue
      }
      sendPayload(client, payload)
    }
  }

  ws.register('/ws/embedded-test', async (socket, queryParams) => {
    const client = socket as EmbeddedTestSocket
    const sessionId = queryParams.get('sessionId')
    if (!sessionId) {
      client.close?.(1008, 'missing sessionId')
      return
    }

    const session = asEmbeddedTestSession(await sessions.get(sessionId))
    if (!session) {
      client.close?.(1008, 'invalid session')
      return
    }

    const role = queryParams.get('role')
    client.sessionId = sessionId
    client.isInstructor = role === 'instructor'

    if (!client.isInstructor) {
      const participantId = normalizeParticipantId(queryParams.get('studentId'))
      const participantName = normalizeOptionalParticipantName(queryParams.get('studentName'))

      const adapters = session.data.students.map((student) => ({
        id: student.studentId,
        name: student.name,
        lastSeen: student.lastSeenAt,
        source: student,
      }))

      const result = connectAcceptedSessionParticipant({
        session,
        participants: adapters,
        participantId,
        participantName,
        now: Date.now(),
        createParticipant: (resolvedParticipantId, resolvedParticipantName, createdAt) => ({
          id: resolvedParticipantId,
          name: resolvedParticipantName,
          lastSeen: createdAt,
          source: {
            studentId: resolvedParticipantId,
            name: resolvedParticipantName,
            joinedAt: createdAt,
            lastSeenAt: createdAt,
          },
        }),
        generateParticipantId,
      })

      if (!result) {
        client.close?.(1008, 'waiting-room-required')
        return
      }

      result.participant.source.studentId = result.participant.id ?? result.participant.source.studentId
      result.participant.source.name = result.participant.name
      result.participant.source.lastSeenAt = typeof result.participant.lastSeen === 'number'
        ? result.participant.lastSeen
        : result.participant.source.lastSeenAt

      if (result.isNew) {
        session.data.students.push(result.participant.source)
      }

      client.studentId = result.participantId
      await sessions.set(session.id, session)
    }

    await broadcastState(session.id)

    client.on('message', async (raw: unknown) => {
      const message = parseWsMessage(raw)
      if (!message || message.type !== 'chat-message') {
        return
      }

      const text = normalizeMessageText(message.text)
      if (!text) {
        return
      }

      const currentSession = asEmbeddedTestSession(await sessions.get(session.id))
      if (!currentSession) {
        return
      }

      const sender = client.isInstructor
        ? { senderRole: 'manager' as const, senderId: 'manager', senderName: 'Manager' }
        : (() => {
          const student = currentSession.data.students.find((entry) => entry.studentId === client.studentId)
          return {
            senderRole: 'student' as const,
            senderId: student?.studentId ?? client.studentId ?? 'unknown',
            senderName: student?.name ?? 'Student',
          }
        })()

      currentSession.data.messages.push({
        id: createMessageId(),
        senderRole: sender.senderRole,
        senderId: sender.senderId,
        senderName: sender.senderName,
        text,
        sentAt: Date.now(),
      })
      if (currentSession.data.messages.length > MAX_MESSAGES) {
        currentSession.data.messages.splice(0, currentSession.data.messages.length - MAX_MESSAGES)
      }

      await sessions.set(currentSession.id, currentSession)
      await broadcastState(currentSession.id)
    })

    client.on('close', async () => {
      if (client.sessionId) {
        await broadcastState(client.sessionId)
      }
    })
  })

  app.post('/api/embedded-test/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'embedded-test'
    getSessionData(session)
    await sessions.set(session.id, session)
    res.json({ id: session.id })
  })

  app.get('/api/embedded-test/:sessionId/session', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asEmbeddedTestSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({ session })
  })
}

import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  JavaStringMethodId,
  JavaStringSessionData,
  JavaStringStats,
  JavaStringStudentRecord,
} from '../javaStringPracticeTypes.js'
import { validateMethods, validateStats, validateStudentName } from './routeUtils.js'

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface JavaStringRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface JavaStringSocket extends ActiveBitsWebSocket {
  studentName?: string | null
  studentId?: string | null
  ignoreDisconnect?: boolean
}

interface JavaStringSession extends SessionRecord {
  type?: string
  data: JavaStringSessionData
}

const defaultStats: JavaStringStats = {
  total: 0,
  correct: 0,
  streak: 0,
  longestStreak: 0,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMethods(value: unknown): JavaStringMethodId[] {
  const methods = validateMethods(value)
  return methods ?? ['all']
}

function normalizeStudentRecord(value: unknown): JavaStringStudentRecord | null {
  if (!isPlainObject(value)) return null

  const name = validateStudentName(value.name)
  if (!name) return null

  const stats = validateStats(value.stats) ?? defaultStats
  const joined = typeof value.joined === 'number' ? value.joined : Date.now()
  const lastSeen = typeof value.lastSeen === 'number' ? value.lastSeen : joined

  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    name,
    connected: Boolean(value.connected),
    joined,
    lastSeen,
    stats,
  }
}

function normalizeSessionData(data: unknown): JavaStringSessionData {
  const source = isPlainObject(data) ? data : {}
  const students = Array.isArray(source.students)
    ? source.students
        .map((student) => normalizeStudentRecord(student))
        .filter((student): student is JavaStringStudentRecord => Boolean(student))
    : []

  return {
    ...source,
    students,
    selectedMethods: normalizeMethods(source.selectedMethods),
  }
}

function asJavaStringSession(session: SessionRecord | null): JavaStringSession | null {
  if (!session || session.type !== 'java-string-practice') return null
  session.data = normalizeSessionData(session.data)
  return session as JavaStringSession
}

function generateStudentId(name: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 6)
  return `${name}-${timestamp}-${random}`
}

registerSessionNormalizer('java-string-practice', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupJavaStringPracticeRoutes(
  app: JavaStringRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  function closeDuplicateStudentSockets(currentSocket: JavaStringSocket): void {
    if (!currentSocket.sessionId || !currentSocket.studentId) return
    for (const client of ws.wss.clients as Set<JavaStringSocket>) {
      if (
        client !== currentSocket &&
        client.readyState === 1 &&
        client.sessionId === currentSocket.sessionId &&
        client.studentId === currentSocket.studentId
      ) {
        client.ignoreDisconnect = true
        try {
          client.close(4000, 'Replaced by new connection')
        } catch (error) {
          console.error('Failed to close duplicate student socket', error)
        }
      }
    }
  }

  async function broadcast(type: string, payload: unknown, sessionId: string): Promise<void> {
    const message = JSON.stringify({ type, payload })

    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, { type, payload } as Record<string, unknown>)
    }

    for (const socket of ws.wss.clients as Set<JavaStringSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(message)
        } catch (error) {
          console.error('Failed to send to client:', error)
        }
      }
    }
  }

  ws.register('/ws/java-string-practice', (socket, query) => {
    const client = socket as JavaStringSocket
    client.sessionId = query.get('sessionId') || null
    if (client.sessionId) {
      ensureBroadcastSubscription(client.sessionId)
    }

    client.studentName = validateStudentName(query.get('studentName'))
    client.studentId = query.get('studentId') || null

    if (client.sessionId && client.studentName) {
      const activeSessionId = client.sessionId
      const activeStudentName = client.studentName
      ;(async () => {
        const session = asJavaStringSession(await sessions.get(activeSessionId))
        if (!session) return

        const existingStudent = client.studentId
          ? session.data.students.find((student) => student.id === client.studentId)
          : session.data.students.find((student) => student.name === activeStudentName && !student.id)

        if (existingStudent) {
          existingStudent.connected = true
          existingStudent.lastSeen = Date.now()
          client.studentId = existingStudent.id || null
          closeDuplicateStudentSockets(client)
        } else {
          const newId = generateStudentId(activeStudentName)
          client.studentId = newId
          session.data.students.push({
            id: newId,
            name: activeStudentName,
            connected: true,
            joined: Date.now(),
            lastSeen: Date.now(),
            stats: { ...defaultStats },
          })
          closeDuplicateStudentSockets(client)
        }

        await sessions.set(session.id, session)
        await broadcast('studentsUpdate', { students: session.data.students }, session.id)
        if (client.studentId) {
          client.send(JSON.stringify({ type: 'studentId', payload: { studentId: client.studentId } }))
        }
      })().catch((error) => console.error('Error in student join:', error))
    }

    client.on('close', () => {
      if (client.ignoreDisconnect || !client.sessionId || !client.studentId) return
      const activeSessionId = client.sessionId
      const activeStudentId = client.studentId

      ;(async () => {
        const session = asJavaStringSession(await sessions.get(activeSessionId))
        if (!session) return
        const student = session.data.students.find((entry) => entry.id === activeStudentId)
        if (!student) return

        student.connected = false
        await sessions.set(session.id, session)
        await broadcast('studentsUpdate', { students: session.data.students }, session.id)
      })().catch((error) => console.error('Error in student disconnect:', error))
    })
  })

  app.post('/api/java-string-practice/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'java-string-practice'
    session.data = normalizeSessionData(session.data)
    await sessions.set(session.id, session)
    ensureBroadcastSubscription(session.id)
    res.json({ id: session.id })
  })

  app.get('/api/java-string-practice/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaStringSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({
      sessionId: session.id,
      type: session.type,
      selectedMethods: session.data.selectedMethods,
    })
  })

  app.post('/api/java-string-practice/:sessionId/methods', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaStringSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const methods = validateMethods(body.methods)
    if (!methods) {
      res.status(400).json({ error: 'valid methods array required' })
      return
    }

    session.data.selectedMethods = methods
    await sessions.set(session.id, session)
    await broadcast('methodsUpdate', { selectedMethods: methods }, session.id)
    res.json({ success: true, selectedMethods: methods })
  })

  app.post('/api/java-string-practice/:sessionId/progress', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaStringSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const stats = validateStats(body.stats)
    if (!stats) {
      res.status(400).json({ error: 'valid stats object required' })
      return
    }

    const bodyStudentId = typeof body.studentId === 'string' ? body.studentId : null
    const bodyStudentName = validateStudentName(body.studentName)

    let student = bodyStudentId
      ? session.data.students.find((entry) => entry.id === bodyStudentId)
      : undefined

    if (!student && bodyStudentName) {
      student = session.data.students.find((entry) => entry.name === bodyStudentName && !entry.id)
    }

    if (student) {
      student.stats = stats
      student.lastSeen = Date.now()
      await sessions.set(session.id, session)
      await broadcast('studentsUpdate', { students: session.data.students }, session.id)
    }

    res.json({ success: true })
  })

  app.get('/api/java-string-practice/:sessionId/students', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaStringSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({ students: session.data.students })
  })
}

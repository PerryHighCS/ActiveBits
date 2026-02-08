import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  JavaFormatSessionData,
  JavaFormatStats,
  JavaFormatStudentRecord,
} from '../javaFormatPracticeTypes.js'
import { validateDifficulty, validateStats, validateStudentName, validateTheme } from './routeUtils.js'

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface JavaFormatRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface JavaFormatSocket extends ActiveBitsWebSocket {
  studentName?: string | null
  studentId?: string | null
  ignoreDisconnect?: boolean
}

interface JavaFormatSession extends SessionRecord {
  type?: string
  data: JavaFormatSessionData
}

const defaultStats: JavaFormatStats = {
  total: 0,
  correct: 0,
  streak: 0,
  longestStreak: 0,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStudentRecord(value: unknown): JavaFormatStudentRecord | null {
  if (!isPlainObject(value)) return null

  const name = validateStudentName(value.name)
  if (!name) return null

  const joined = typeof value.joined === 'number' ? value.joined : Date.now()
  const lastSeen = typeof value.lastSeen === 'number' ? value.lastSeen : joined
  const stats = validateStats(value.stats) ?? { ...defaultStats }

  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    name,
    connected: Boolean(value.connected),
    joined,
    lastSeen,
    stats,
  }
}

function normalizeSessionData(data: unknown): JavaFormatSessionData {
  const source = isPlainObject(data) ? data : {}
  const students = Array.isArray(source.students)
    ? source.students
        .map((student) => normalizeStudentRecord(student))
        .filter((student): student is JavaFormatStudentRecord => Boolean(student))
    : []

  return {
    ...source,
    students,
    selectedDifficulty: validateDifficulty(source.selectedDifficulty),
    selectedTheme: validateTheme(source.selectedTheme),
  }
}

function asJavaFormatSession(session: SessionRecord | null): JavaFormatSession | null {
  if (!session || session.type !== 'java-format-practice') {
    return null
  }

  session.data = normalizeSessionData(session.data)
  return session as JavaFormatSession
}

function generateStudentId(name: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 6)
  return `${name}-${timestamp}-${random}`
}

registerSessionNormalizer('java-format-practice', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupJavaFormatPracticeRoutes(
  app: JavaFormatRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  function closeDuplicateStudentSockets(currentSocket: JavaFormatSocket): void {
    if (!currentSocket.sessionId || !currentSocket.studentId) return

    for (const client of ws.wss.clients as Set<JavaFormatSocket>) {
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

    let clientCount = 0
    for (const socket of ws.wss.clients as Set<JavaFormatSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(message)
          clientCount += 1
        } catch (error) {
          console.error('Failed to send to client:', error)
        }
      }
    }

    console.log(`Broadcast ${type} to ${clientCount} clients in session ${sessionId}`)
  }

  ws.register('/ws/java-format-practice', (socket, query) => {
    const client = socket as JavaFormatSocket
    client.sessionId = query.get('sessionId') || null
    ensureBroadcastSubscription(client.sessionId)

    const studentId = query.get('studentId') || null
    client.studentName = validateStudentName(query.get('studentName'))

    console.log(
      `WebSocket connection: sessionId=${client.sessionId}, studentName=${client.studentName}, studentId=${studentId}`,
    )

    if (client.sessionId && client.studentName) {
      const activeSessionId = client.sessionId
      const activeStudentName = client.studentName

      ;(async () => {
        const session = asJavaFormatSession(await sessions.get(activeSessionId))
        console.log('Found session:', session ? 'yes' : 'no')
        if (!session) return

        const existing = studentId
          ? session.data.students.find((student) => student.id === studentId)
          : session.data.students.find((student) => student.name === activeStudentName && !student.id)

        if (existing) {
          console.log(`Reconnecting student: ${activeStudentName} (${existing.id})`)
          existing.connected = true
          existing.lastSeen = Date.now()
          client.studentId = existing.id || null
          closeDuplicateStudentSockets(client)
        } else {
          console.log(`New student joining: ${activeStudentName}`)
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
        console.log('Total students in session:', session.data.students.length)
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
        const session = asJavaFormatSession(await sessions.get(activeSessionId))
        if (!session) return

        const student = session.data.students.find((entry) => entry.id === activeStudentId)
        if (!student) return

        student.connected = false
        await sessions.set(session.id, session)
        await broadcast('studentsUpdate', { students: session.data.students }, session.id)
      })().catch((error) => console.error('Error in student disconnect:', error))
    })
  })

  app.post('/api/java-format-practice/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'java-format-practice'
    session.data = normalizeSessionData(session.data)

    await sessions.set(session.id, session)
    ensureBroadcastSubscription(session.id)
    res.json({ id: session.id })
  })

  app.get('/api/java-format-practice/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({
      sessionId: session.id,
      type: session.type,
      selectedDifficulty: session.data.selectedDifficulty,
      selectedTheme: session.data.selectedTheme,
    })
  })

  app.post('/api/java-format-practice/:sessionId/difficulty', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const difficulty = validateDifficulty(body.difficulty)

    console.log(`Updating difficulty for session ${session.id}:`, difficulty)
    session.data.selectedDifficulty = difficulty
    await sessions.set(session.id, session)
    await broadcast('difficultyUpdate', { difficulty }, session.id)

    res.json({ success: true, difficulty })
  })

  app.post('/api/java-format-practice/:sessionId/theme', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const theme = validateTheme(body.theme)

    console.log(`Updating theme for session ${session.id}:`, theme)
    session.data.selectedTheme = theme
    await sessions.set(session.id, session)
    await broadcast('themeUpdate', { theme }, session.id)

    res.json({ success: true, theme })
  })

  app.post('/api/java-format-practice/:sessionId/stats', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
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

    const studentId = typeof body.studentId === 'string' ? body.studentId : null
    const student = session.data.students.find((entry) => entry.id === studentId)
    if (student) {
      student.stats = stats
      student.lastSeen = Date.now()
      await sessions.set(session.id, session)
      await broadcast('studentsUpdate', { students: session.data.students }, session.id)
    }

    res.json({ success: true })
  })

  app.get('/api/java-format-practice/:sessionId/students', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const session = asJavaFormatSession(await sessions.get(sessionId))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    res.json({ students: session.data.students })
  })
}

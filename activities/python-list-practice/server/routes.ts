import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  PythonListPracticeSessionData,
  PythonListPracticeStats,
  PythonListPracticeStudent,
} from '../pythonListPracticeTypes.js'
import { sanitizeQuestionTypes, validateName, validateStats, validateStudentId } from './routeUtils.js'

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface PythonListPracticeRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface PythonListPracticeSocket extends ActiveBitsWebSocket {
  studentName?: string | null
  studentId?: string | null
}

interface PythonListPracticeSession extends SessionRecord {
  type?: string
  data: PythonListPracticeSessionData
}

const defaultStats: PythonListPracticeStats = {
  total: 0,
  correct: 0,
  streak: 0,
  longestStreak: 0,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSessionData(data: unknown): PythonListPracticeSessionData {
  const source = isPlainObject(data) ? data : {}
  const students = Array.isArray(source.students)
    ? (source.students as unknown[])
        .map((student) => {
          if (!isPlainObject(student)) return null
          const name = validateName(student.name)
          if (!name) return null
          return {
            id:
              typeof student.id === 'string'
                ? student.id
                : `${name}-${Date.now().toString(36)}`,
            name,
            stats: validateStats(student.stats) ?? defaultStats,
            connected: Boolean(student.connected),
            lastSeen: typeof student.lastSeen === 'number' ? student.lastSeen : undefined,
          } as PythonListPracticeStudent
        })
        .filter((student): student is PythonListPracticeStudent => Boolean(student))
    : []

  return {
    students,
    selectedQuestionTypes: sanitizeQuestionTypes(source.selectedQuestionTypes),
  }
}

function asPythonListPracticeSession(
  session: SessionRecord | null,
): PythonListPracticeSession | null {
  if (!session || session.type !== 'python-list-practice') return null
  session.data = normalizeSessionData(session.data)
  return session as PythonListPracticeSession
}

registerSessionNormalizer('python-list-practice', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupPythonListPracticeRoutes(
  app: PythonListPracticeRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  async function broadcast(
    type: string,
    payload: unknown,
    sessionId: string,
  ): Promise<void> {
    const message = JSON.stringify({ type, payload })

    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, {
        type,
        payload,
      } as Record<string, unknown>)
    }

    for (const socket of ws.wss.clients as Set<PythonListPracticeSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(message)
        } catch (err) {
          console.error('WS send failed', err)
        }
      }
    }
  }

  app.post('/api/python-list-practice/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'python-list-practice'
    session.data = {
      students: [],
      selectedQuestionTypes: ['all'],
    }
    await sessions.set(session.id, session)
    ensureBroadcastSubscription(session.id)
    const response = res as unknown as JsonResponse
    response.json({ id: session.id })
  })

  app.get('/api/python-list-practice/:sessionId', async (req, res) => {
    const sessionId = (req.params as Record<string, unknown>)
      .sessionId as string | undefined
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asPythonListPracticeSession(await sessions.get(sessionId))
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const response = res as unknown as JsonResponse
    response.json({
      students: session.data.students || [],
      selectedQuestionTypes: session.data.selectedQuestionTypes || ['all'],
    })
  })

  app.get('/api/python-list-practice/:sessionId/students', async (req, res) => {
    const sessionId = (req.params as Record<string, unknown>)
      .sessionId as string | undefined
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asPythonListPracticeSession(await sessions.get(sessionId))
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const response = res as unknown as JsonResponse
    response.json({ students: session.data.students || [] })
  })

  app.post('/api/python-list-practice/:sessionId/stats', async (req, res) => {
    const sessionId = (req.params as Record<string, unknown>)
      .sessionId as string | undefined
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asPythonListPracticeSession(await sessions.get(sessionId))
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const reqBody = isPlainObject(req.body) ? req.body : {}
    const studentName = validateName(reqBody.studentName)
    const studentId = validateStudentId(reqBody.studentId)
    const stats = validateStats(reqBody.stats)

    if ((!studentName && !studentId) || !stats) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'invalid payload' })
      return
    }

    const student = session.data.students.find(
      (s) => (studentId && s.id === studentId) || (studentName && s.name === studentName && !s.id),
    )

    if (student) {
      student.stats = stats
      student.lastSeen = Date.now()
    } else {
      session.data.students.push({
        id: studentId || `${studentName}-${Date.now().toString(36)}`,
        name: studentName || 'Student',
        stats,
        connected: true,
        lastSeen: Date.now(),
      })
    }

    await sessions.set(session.id, session)
    await broadcast('studentsUpdate', { students: session.data.students }, session.id)

    const response = res as unknown as JsonResponse
    response.json({ ok: true })
  })

  app.post('/api/python-list-practice/:sessionId/question-types', async (req, res) => {
    const sessionId = (req.params as Record<string, unknown>)
      .sessionId as string | undefined
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = asPythonListPracticeSession(await sessions.get(sessionId))
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const reqBody = isPlainObject(req.body) ? req.body : {}
    const questionTypes = sanitizeQuestionTypes(reqBody.types)
    session.data.selectedQuestionTypes = questionTypes
    await sessions.set(session.id, session)
    await broadcast('questionTypesUpdate', { selectedQuestionTypes: questionTypes }, session.id)

    const response = res as unknown as JsonResponse
    response.json({ ok: true, selectedQuestionTypes: questionTypes })
  })

  ws.register('/ws/python-list-practice', (socket, qp) => {
    const client = socket as PythonListPracticeSocket
    client.sessionId = qp.get('sessionId') || null
    if (client.sessionId) {
      ensureBroadcastSubscription(client.sessionId)
    }

    client.studentName = validateName(qp.get('studentName') || '')
    client.studentId = validateStudentId(qp.get('studentId') || '')

    const sendQuestionTypesSnapshot = async (): Promise<void> => {
      if (!client.sessionId) return
      const session = asPythonListPracticeSession(await sessions.get(client.sessionId))
      if (session) {
        const payload = {
          selectedQuestionTypes: session.data.selectedQuestionTypes || ['all'],
        }
        try {
          client.send(JSON.stringify({ type: 'questionTypesUpdate', payload }))
        } catch (err) {
          console.error('WS send failed', err)
        }
      }
    }

    if (client.sessionId) {
      sendQuestionTypesSnapshot().catch((err) => {
        console.error('Failed to send initial question types snapshot:', err)
      })
    }

    if (client.sessionId && client.studentName) {
      ;(async (): Promise<void> => {
        const session = asPythonListPracticeSession(
          await sessions.get(client.sessionId!),
        )
        if (session) {
          const existing = session.data.students.find(
            (s) =>
              (client.studentId && s.id === client.studentId) ||
              (client.studentName && s.name === client.studentName && !s.id),
          )

          if (existing) {
            existing.connected = true
            existing.lastSeen = Date.now()
          } else {
            const newStudent: PythonListPracticeStudent = {
              id: client.studentId || `${client.studentName || 'student'}-${Date.now().toString(36)}`,
              name: client.studentName || 'Student',
              stats: { ...defaultStats },
              connected: true,
              lastSeen: Date.now(),
            }
            session.data.students.push(newStudent)
          }

          await sessions.set(session.id, session)
          await broadcast('studentsUpdate', { students: session.data.students }, session.id)
          await sendQuestionTypesSnapshot()

          client.on('close', () => {
            ;(async (): Promise<void> => {
              const sess = asPythonListPracticeSession(
                await sessions.get(client.sessionId!),
              )
              if (sess) {
                const student = sess.data.students.find((s) => s.name === client.studentName)
                if (student) {
                  student.connected = false
                  await sessions.set(sess.id, sess)
                  await broadcast('studentsUpdate', { students: sess.data.students }, sess.id)
                }
              }
            })().catch((err) => console.error('Error in close handler:', err))
          })
        }
      })().catch((err) => console.error('Error in WS handler:', err))
    }
  })
}

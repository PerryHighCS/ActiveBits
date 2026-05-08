import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { generateParticipantId } from 'activebits-server/core/participantIds.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  BinaryBreachAnswer,
  BinaryBreachSessionData,
  BinaryBreachStudentRecord,
} from '../binaryBreachTypes.js'
import {
  DEFAULT_BINARY_BREACH_SETTINGS,
  createBinaryBreachChallenge,
  createMissionSeed,
  getHintForChallenge,
  normalizeBinaryBreachSettings,
} from '../shared/challengeGenerator.js'
import { serializeAnswerFromUnknown, validateBinaryBreachAnswer } from '../shared/challengeValidation.js'
import { applyAnswerResult, applyHintUse, createInitialProgress } from '../shared/scoring.js'
import {
  isPlainObject,
  normalizeBinaryBreachSettingsFromSessionData,
  normalizeBinaryBreachStudent,
  validateStudentId,
  validateStudentName,
} from './routeUtils.js'

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface BinaryBreachRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface BinaryBreachSession extends SessionRecord {
  type?: string
  data: BinaryBreachSessionData
}

interface BinaryBreachSocket extends ActiveBitsWebSocket {
  studentId?: string | null
  studentName?: string | null
}

function normalizeSessionData(data: unknown): BinaryBreachSessionData {
  const source = isPlainObject(data) ? data : {}
  const settings = normalizeBinaryBreachSettingsFromSessionData(source)
  const students = Array.isArray(source.students)
    ? source.students
        .map((student) => normalizeBinaryBreachStudent(student, settings))
        .filter((student): student is BinaryBreachStudentRecord => Boolean(student))
    : []
  return {
    settings,
    students,
    missionSeed: typeof source.missionSeed === 'string' && source.missionSeed.length > 0
      ? source.missionSeed
      : createMissionSeed(),
    active: source.active !== false,
  }
}

function asBinaryBreachSession(session: SessionRecord | null): BinaryBreachSession | null {
  if (!session || session.type !== 'binary-breach') return null
  session.data = normalizeSessionData(session.data)
  return session as BinaryBreachSession
}

function findStudent(
  students: BinaryBreachStudentRecord[],
  studentId: string | null,
  studentName: string | null,
): BinaryBreachStudentRecord | null {
  return students.find((student) => student.id === studentId)
    ?? students.find((student) => (
      !validateStudentId(student.id)
      && student.name.toLowerCase() === studentName?.toLowerCase()
    ))
    ?? null
}

function ensureStudent(
  session: BinaryBreachSession,
  studentIdInput: unknown,
  studentNameInput: unknown,
): BinaryBreachStudentRecord | null {
  const studentName = validateStudentName(studentNameInput)
  const studentId = validateStudentId(studentIdInput)
  if (!studentName && !studentId) return null
  const existing = findStudent(session.data.students, studentId, studentName)
  if (existing) {
    existing.name = studentName ?? existing.name
    existing.connected = true
    existing.lastSeen = Date.now()
    if (!existing.currentChallenge && !existing.progress.completed) {
      existing.currentChallenge = createBinaryBreachChallenge(
        session.data.settings,
        `${session.data.missionSeed}:${existing.id}`,
        existing.challengeIndex,
      )
    }
    return existing
  }
  const now = Date.now()
  const id = studentId ?? generateParticipantId()
  const student: BinaryBreachStudentRecord = {
    id,
    name: studentName ?? 'Student',
    connected: true,
    joined: now,
    lastSeen: now,
    progress: createInitialProgress(),
    currentChallenge: createBinaryBreachChallenge(session.data.settings, `${session.data.missionSeed}:${id}`, 0),
    challengeIndex: 0,
  }
  session.data.students.push(student)
  return student
}

function resetStudentMission(
  session: BinaryBreachSession,
  student: BinaryBreachStudentRecord,
): void {
  student.progress = createInitialProgress()
  student.challengeIndex = 0
  student.currentChallenge = createBinaryBreachChallenge(
    session.data.settings,
    `${session.data.missionSeed}:${student.id}`,
    0,
  )
  student.lastSeen = Date.now()
}

function startNewMission(session: BinaryBreachSession): void {
  session.data.missionSeed = createMissionSeed()
  session.data.active = true
  for (const student of session.data.students) {
    resetStudentMission(session, student)
  }
}

function toRosterStudent(student: BinaryBreachStudentRecord): Record<string, unknown> {
  return {
    name: student.name,
    connected: student.connected,
    progress: student.progress,
    challengeIndex: student.challengeIndex,
  }
}

registerSessionNormalizer('binary-breach', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupBinaryBreachRoutes(
  app: BinaryBreachRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  async function broadcast(type: string, payload: unknown, sessionId: string): Promise<void> {
    const message = JSON.stringify({ type, payload })
    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, { type, payload } as Record<string, unknown>)
    }
    for (const socket of ws.wss.clients as Set<BinaryBreachSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(message)
        } catch (error) {
          console.error(JSON.stringify({ event: 'binary-breach.ws-send-failed', sessionId, error: String(error) }))
        }
      }
    }
  }

  async function broadcastRoster(session: BinaryBreachSession): Promise<void> {
    await broadcast(
      'binary-breach:roster',
      { students: session.data.students.map(toRosterStudent), settings: session.data.settings },
      session.id,
    )
  }

  function sendStudentMissionState(
    socket: BinaryBreachSocket,
    session: BinaryBreachSession,
    student: BinaryBreachStudentRecord,
    type: string,
  ): void {
    try {
      socket.send(JSON.stringify({
        type,
        payload: {
          challenge: student.currentChallenge,
          progress: student.progress,
          settings: session.data.settings,
        },
      }))
    } catch (error) {
      console.error(JSON.stringify({ event: 'binary-breach.ws-student-state-send-failed', sessionId: session.id, error: String(error) }))
    }
  }

  function broadcastStudentMissionStates(session: BinaryBreachSession, type: string): void {
    for (const socket of ws.wss.clients as Set<BinaryBreachSocket>) {
      if (socket.readyState !== 1 || socket.sessionId !== session.id) {
        continue
      }
      const student = findStudent(session.data.students, socket.studentId ?? null, socket.studentName ?? null)
      if (!student) {
        continue
      }
      sendStudentMissionState(socket, session, student, type)
    }
  }

  app.post('/api/binary-breach/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'binary-breach'
    session.data = {
      settings: { ...DEFAULT_BINARY_BREACH_SETTINGS },
      students: [],
      missionSeed: createMissionSeed(),
      active: true,
    }
    await sessions.set(session.id, session)
    ensureBroadcastSubscription(session.id)
    res.json({ id: session.id })
  })

  app.get('/api/binary-breach/:sessionId/state', async (req, res) => {
    const session = asBinaryBreachSession(await sessions.get(req.params.sessionId ?? ''))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    res.json({
      settings: session.data.settings,
      students: session.data.students.map(toRosterStudent),
    })
  })

  app.post('/api/binary-breach/:sessionId/settings', async (req, res) => {
    const session = asBinaryBreachSession(await sessions.get(req.params.sessionId ?? ''))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    session.data.settings = normalizeBinaryBreachSettings(req.body)
    await sessions.set(session.id, session)
    await broadcastRoster(session)
    res.json({ ok: true, settings: session.data.settings })
  })

  app.post('/api/binary-breach/:sessionId/mission/new', async (req, res) => {
    const session = asBinaryBreachSession(await sessions.get(req.params.sessionId ?? ''))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    startNewMission(session)
    await sessions.set(session.id, session)
    await broadcastRoster(session)
    broadcastStudentMissionStates(session, 'binary-breach:mission-reset')
    res.json({
      ok: true,
      settings: session.data.settings,
      students: session.data.students.map(toRosterStudent),
    })
  })

  app.post('/api/binary-breach/:sessionId/student/register', async (req, res) => {
    const session = asBinaryBreachSession(await sessions.get(req.params.sessionId ?? ''))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    const body = isPlainObject(req.body) ? req.body : {}
    const student = ensureStudent(session, body.studentId, body.studentName)
    if (!student) {
      res.status(400).json({ error: 'invalid student' })
      return
    }
    await sessions.set(session.id, session)
    await broadcastRoster(session)
    res.json({
      studentId: student.id,
      studentName: student.name,
      challenge: student.currentChallenge,
      progress: student.progress,
      settings: session.data.settings,
    })
  })

  app.post('/api/binary-breach/:sessionId/student/answer', async (req, res) => {
    const session = asBinaryBreachSession(await sessions.get(req.params.sessionId ?? ''))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    const body = isPlainObject(req.body) ? req.body : {}
    const student = ensureStudent(session, body.studentId, body.studentName)
    if (!student || !student.currentChallenge) {
      res.status(400).json({ error: 'invalid student' })
      return
    }
    if (typeof body.challengeId === 'string' && body.challengeId !== student.currentChallenge.id) {
      res.status(409).json({
        error: 'stale_challenge',
        challenge: student.currentChallenge,
        progress: student.progress,
        settings: session.data.settings,
      })
      return
    }
    const answer = serializeAnswerFromUnknown(student.currentChallenge, body.answer) as BinaryBreachAnswer | null
    if (!answer) {
      res.status(400).json({ error: 'invalid answer' })
      return
    }
    const feedback = validateBinaryBreachAnswer(student.currentChallenge, answer)
    student.progress = applyAnswerResult(student.progress, feedback.correct, session.data.settings.missionLength)
    if (!student.progress.completed) {
      student.challengeIndex += 1
      student.currentChallenge = createBinaryBreachChallenge(
        session.data.settings,
        `${session.data.missionSeed}:${student.id}`,
        student.challengeIndex,
      )
    } else {
      student.currentChallenge = null
    }
    student.lastSeen = Date.now()
    await sessions.set(session.id, session)
    await broadcastRoster(session)
    res.json({
      feedback,
      progress: student.progress,
      challenge: student.currentChallenge,
      settings: session.data.settings,
    })
  })

  app.post('/api/binary-breach/:sessionId/student/retry', async (req, res) => {
    const session = asBinaryBreachSession(await sessions.get(req.params.sessionId ?? ''))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    const body = isPlainObject(req.body) ? req.body : {}
    const student = ensureStudent(session, body.studentId, body.studentName)
    if (!student) {
      res.status(400).json({ error: 'invalid student' })
      return
    }
    resetStudentMission(session, student)
    await sessions.set(session.id, session)
    await broadcastRoster(session)
    res.json({
      studentId: student.id,
      studentName: student.name,
      challenge: student.currentChallenge,
      progress: student.progress,
      settings: session.data.settings,
    })
  })

  app.post('/api/binary-breach/:sessionId/student/hint', async (req, res) => {
    const session = asBinaryBreachSession(await sessions.get(req.params.sessionId ?? ''))
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    const body = isPlainObject(req.body) ? req.body : {}
    const student = ensureStudent(session, body.studentId, body.studentName)
    if (!student || !student.currentChallenge || !session.data.settings.hintsEnabled) {
      res.status(400).json({ error: 'hint unavailable' })
      return
    }
    student.progress = applyHintUse(student.progress)
    student.currentChallenge = {
      ...student.currentChallenge,
      hintLevel: student.currentChallenge.hintLevel + 1,
    }
    await sessions.set(session.id, session)
    await broadcastRoster(session)
    res.json({
      hint: getHintForChallenge(student.currentChallenge),
      progress: student.progress,
      challenge: student.currentChallenge,
      settings: session.data.settings,
    })
  })

  ws.register('/ws/binary-breach', (socket, qp) => {
    const client = socket as BinaryBreachSocket
    client.sessionId = qp.get('sessionId') || null
    client.studentId = validateStudentId(qp.get('studentId'))
    client.studentName = validateStudentName(qp.get('studentName'))
    if (client.sessionId) {
      ensureBroadcastSubscription(client.sessionId)
      ;(async () => {
        const session = asBinaryBreachSession(await sessions.get(client.sessionId ?? ''))
        if (!session) return
        if (client.studentName || client.studentId) {
          ensureStudent(session, client.studentId, client.studentName)
          await sessions.set(session.id, session)
        }
        await broadcastRoster(session)
      })().catch((error) => {
        console.error(JSON.stringify({ event: 'binary-breach.ws-open-failed', error: String(error) }))
      })
    }
    client.on('close', () => {
      if (!client.sessionId || !client.studentId) return
      ;(async () => {
        const session = asBinaryBreachSession(await sessions.get(client.sessionId ?? ''))
        if (!session) return
        const student = findStudent(session.data.students, client.studentId ?? null, null)
        if (!student) return
        student.connected = false
        student.lastSeen = Date.now()
        await sessions.set(session.id, session)
        await broadcastRoster(session)
      })().catch((error) => {
        console.error(JSON.stringify({ event: 'binary-breach.ws-close-failed', error: String(error) }))
      })
    })
  })
}

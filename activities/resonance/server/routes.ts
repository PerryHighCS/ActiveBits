import { timingSafeEqual } from 'crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import {
  generatePersistentHash,
  verifyTeacherCodeWithHash,
} from 'activebits-server/core/persistentSessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  InstructorAnnotation,
  Question,
  QuestionReveal,
  Response,
  Student,
} from '../shared/types.js'
import { validateAnswerPayload, validateQuestion, validateQuestionSet, validateStudentRegistration } from '../shared/validation.js'
import { decryptQuestions, encryptQuestions, MAX_ENCODED_PAYLOAD_CHARS } from './questionCrypto.js'

// ---------------------------------------------------------------------------
// Route-level types
// ---------------------------------------------------------------------------

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
  cookie?(name: string, value: string, options: Record<string, unknown>): void
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
  /** Stored when session is created from a persistent link — used for passcode recovery. */
  persistentHash: string | null
}

interface ResonanceSession extends SessionRecord {
  type?: string
  data: ResonanceSessionData
}

// ---------------------------------------------------------------------------
// Cookie types and helpers
// ---------------------------------------------------------------------------

interface PersistentSessionsCookieEntry {
  key: string
  teacherCode: string
}

const MAX_SESSIONS_PER_COOKIE = 20
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

function parsePersistentSessionsCookie(cookieValue: unknown): PersistentSessionsCookieEntry[] {
  if (cookieValue == null) return []
  let parsed: unknown
  try {
    parsed = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (entry): entry is Record<string, unknown> =>
        isPlainObject(entry) && typeof entry.key === 'string' && typeof entry.teacherCode === 'string',
    )
    .map((entry) => ({
      key: String(entry.key),
      teacherCode: String(entry.teacherCode),
    }))
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
    persistentHash: typeof source.persistentHash === 'string' ? source.persistentHash : null,
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

function verifyInstructorPasscode(expected: string, candidate: string): boolean {
  if (!expected || !candidate) return false
  const exp = Buffer.from(expected, 'utf8')
  const cand = Buffer.from(candidate, 'utf8')
  if (exp.length !== cand.length) return false
  try {
    return timingSafeEqual(exp, cand)
  } catch {
    return false
  }
}

function checkInstructorAuth(req: RouteRequest, session: ResonanceSession): boolean {
  const header = req.headers?.['x-instructor-passcode']
  return typeof header === 'string' && verifyInstructorPasscode(session.data.instructorPasscode, header)
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

  // ---------------------------------------------------------------------------
  // POST /api/resonance/create
  // Creates a new session. Optionally accepts encoded questions from a
  // persistent link so they can be pre-loaded into the session.
  // ---------------------------------------------------------------------------
  app.post('/api/resonance/create', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const instructorPasscode = generatePasscode()

    let questions: Question[] = []
    let persistentHash: string | null = null

    // If a persistent link is being entered, decrypt the pre-loaded question set.
    const encodedQuestions = typeof body.encodedQuestions === 'string' ? body.encodedQuestions : null
    const candidateHash = typeof body.persistentHash === 'string' ? body.persistentHash : null

    if (encodedQuestions && candidateHash) {
      const decrypted = decryptQuestions(encodedQuestions, candidateHash)
      if (decrypted !== null && decrypted.length > 0) {
        questions = decrypted
        persistentHash = candidateHash
      } else {
        console.warn('[resonance] Persistent link question decryption failed', { candidateHash })
      }
    }

    const session = await createSession(sessions, {
      data: normalizeSessionData({ instructorPasscode, questions, persistentHash }),
    })
    session.type = 'resonance'
    await sessions.set(session.id, session)

    console.info('[resonance] Session created', {
      sessionId: session.id,
      questionCount: questions.length,
      fromPersistentLink: persistentHash !== null,
    })

    res.json({ id: session.id, instructorPasscode })
  })

  // ---------------------------------------------------------------------------
  // POST /api/resonance/generate-link
  // Validates and encrypts a question set, stores the teacher code in the
  // persistent_sessions cookie, and returns the authoritative persistent URL.
  // ---------------------------------------------------------------------------
  app.post('/api/resonance/generate-link', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}

    // Validate teacher code
    const teacherCode = typeof body.teacherCode === 'string' ? body.teacherCode.trim() : ''
    if (teacherCode.length < 6) {
      res.status(400).json({ error: 'teacherCode must be at least 6 characters' })
      return
    }
    if (teacherCode.length > 100) {
      res.status(400).json({ error: 'teacherCode must be at most 100 characters' })
      return
    }

    // Validate questions
    if (!Array.isArray(body.questions)) {
      res.status(400).json({ error: 'questions must be an array' })
      return
    }
    const { questions, errors } = validateQuestionSet(body.questions)
    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], details: errors })
      return
    }
    if (questions.length === 0) {
      res.status(400).json({ error: 'question set must not be empty' })
      return
    }

    // Generate hash and encrypt the question payload
    const { hash } = generatePersistentHash('resonance', teacherCode)
    const { encoded, sizeChars } = encryptQuestions(questions, hash)

    if (sizeChars > MAX_ENCODED_PAYLOAD_CHARS) {
      res
        .status(422)
        .json({ error: `Question set is too large for a persistent link (${sizeChars} chars, limit ${MAX_ENCODED_PAYLOAD_CHARS})` })
      return
    }

    // Store teacher code in the persistent_sessions cookie so it can be
    // recovered later via GET /api/resonance/:sessionId/instructor-passcode.
    const cookieName = 'persistent_sessions'
    let sessionEntries = parsePersistentSessionsCookie(req.cookies?.[cookieName])
    const cookieKey = `resonance:${hash}`
    const existingIndex = sessionEntries.findIndex((e) => e.key === cookieKey)
    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1)
    }
    sessionEntries.push({ key: cookieKey, teacherCode })
    if (sessionEntries.length > MAX_SESSIONS_PER_COOKIE) {
      sessionEntries = sessionEntries.slice(-MAX_SESSIONS_PER_COOKIE)
    }

    res.cookie?.(cookieName, JSON.stringify(sessionEntries), {
      maxAge: ONE_YEAR_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    })

    const url = `/manage/resonance?h=${hash}&q=${encoded}`
    console.info('[resonance] Persistent link generated', { hash, questionCount: questions.length, sizeChars })
    res.json({ hash, url })
  })

  // ---------------------------------------------------------------------------
  // GET /api/resonance/:sessionId/instructor-passcode
  // Lets an instructor recover their passcode for an existing session by
  // proving ownership via the persistent_sessions cookie.
  // ---------------------------------------------------------------------------
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

    const { persistentHash } = session.data
    if (!persistentHash) {
      res.status(403).json({ error: 'session was not created from a persistent link' })
      return
    }

    // Verify the teacher owns this persistent session via their cookie
    const cookieEntries = parsePersistentSessionsCookie(req.cookies?.persistent_sessions)
    const entry = cookieEntries.find((e) => e.key === `resonance:${persistentHash}`)
    if (!entry) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const verified = verifyTeacherCodeWithHash('resonance', persistentHash, entry.teacherCode)
    if (!verified.valid) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    console.info('[resonance] Instructor passcode recovered', { sessionId })
    res.json({ instructorPasscode: session.data.instructorPasscode })
  })

  // POST /api/resonance/:sessionId/register-student
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

    const validated = validateStudentRegistration(req.body)
    if (!validated) {
      res.status(400).json({ error: 'name must be a non-empty string (max 80 characters)' })
      return
    }

    // Accept a client-provided studentId (from entry participant handoff) or generate one.
    const body = isPlainObject(req.body) ? req.body : {}
    const requestedId = typeof body.studentId === 'string' && /^[\w-]+$/.test(body.studentId)
      ? body.studentId
      : null
    const studentId = requestedId ?? `s_${Math.random().toString(36).slice(2, 12)}`

    const student: Student = {
      studentId,
      name: validated.name,
      joinedAt: Date.now(),
    }

    session.data.students[studentId] = student
    await sessions.set(sessionId, session)

    console.info('[resonance] Student registered', { sessionId, studentId, name: validated.name })
    res.json({ studentId, name: validated.name })
  })

  // POST /api/resonance/:sessionId/submit-answer
  // Temporary REST path for Phase 4; Phase 7 WS will be the primary channel.
  app.post('/api/resonance/:sessionId/submit-answer', async (req, res) => {
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

    const body = isPlainObject(req.body) ? req.body : {}
    const studentId = typeof body.studentId === 'string' ? body.studentId : null
    if (!studentId || !session.data.students[studentId]) {
      res.status(400).json({ error: 'invalid studentId' })
      return
    }

    const { activeQuestionId, questions, responses } = session.data
    if (!activeQuestionId) {
      res.status(409).json({ error: 'no active question' })
      return
    }

    const activeQuestion = questions.find((q) => q.id === activeQuestionId) ?? null
    if (!activeQuestion) {
      res.status(409).json({ error: 'active question not found' })
      return
    }

    // Reject duplicate submissions for the same question.
    const alreadyAnswered = responses.some(
      (r) => r.questionId === activeQuestionId && r.studentId === studentId,
    )
    if (alreadyAnswered) {
      res.status(409).json({ error: 'already submitted an answer for this question' })
      return
    }

    const answer = validateAnswerPayload(body.answer, activeQuestion)
    if (!answer) {
      res.status(400).json({ error: 'invalid answer payload' })
      return
    }

    const response: Response = {
      id: `r_${Math.random().toString(36).slice(2, 12)}`,
      questionId: activeQuestionId,
      studentId,
      submittedAt: Date.now(),
      answer,
    }

    session.data.responses.push(response)
    await sessions.set(sessionId, session)

    console.info('[resonance] Answer submitted', { sessionId, studentId, questionId: activeQuestionId })
    res.json({ ok: true })
  })

  // GET /api/resonance/:sessionId/state
  // Returns a StudentSessionSnapshot — no isCorrect fields exposed before reveal.
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

    // Strip isCorrect from MCQ options for student-safe representation.
    function toStudentQuestion(q: Question) {
      if (q.type === 'free-response') return q
      return { ...q, options: q.options.map(({ id, text }) => ({ id, text })) }
    }

    const activeQuestion =
      activeQuestionId !== null
        ? (questions.find((q) => q.id === activeQuestionId) ?? null)
        : null

    const revealedQuestionIds = new Set(reveals.map((r) => r.questionId))
    const revealedQuestions = questions
      .filter((q) => revealedQuestionIds.has(q.id))
      .map(toStudentQuestion)

    res.json({
      sessionId,
      activeQuestion: activeQuestion !== null ? toStudentQuestion(activeQuestion) : null,
      reveals,
      revealedQuestions,
    })
  })

  // GET /api/resonance/:sessionId/responses
  // Returns the full instructor session snapshot with student names and annotations.
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const { questions, activeQuestionId, students, responses, annotations, reveals, responseOrderOverrides } =
      session.data

    // Enrich responses with student names.
    const responsesWithNames = responses.map((r) => ({
      ...r,
      studentName: students[r.studentId]?.name ?? 'Unknown',
    }))

    res.json({
      sessionId,
      questions,
      activeQuestionId,
      students: Object.values(students),
      responses: responsesWithNames,
      annotations,
      reveals,
      responseOrderOverrides,
    })
  })

  // POST /api/resonance/:sessionId/activate-question
  // Sets the active question. Pass null to deactivate.
  app.post('/api/resonance/:sessionId/activate-question', async (req, res) => {
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const questionId = body.questionId === null ? null
      : typeof body.questionId === 'string' ? body.questionId
      : undefined

    if (questionId === undefined) {
      res.status(400).json({ error: 'questionId must be a string or null' })
      return
    }

    if (questionId !== null && !session.data.questions.some((q) => q.id === questionId)) {
      res.status(404).json({ error: 'question not found' })
      return
    }

    session.data.activeQuestionId = questionId
    await sessions.set(sessionId, session)

    console.info('[resonance] Question activated', { sessionId, questionId })
    void broadcast('resonance:question-activated', { questionId }, sessionId)
    res.json({ ok: true, activeQuestionId: questionId })
  })

  // POST /api/resonance/:sessionId/add-question
  // Adds a new question to the session's question set.
  app.post('/api/resonance/:sessionId/add-question', async (req, res) => {
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const errors: string[] = []
    const question = validateQuestion(req.body, errors)
    if (!question || errors.length > 0) {
      res.status(400).json({ error: errors[0] ?? 'invalid question', details: errors })
      return
    }

    // Enforce unique IDs within the set.
    if (session.data.questions.some((q) => q.id === question.id)) {
      res.status(409).json({ error: 'a question with that id already exists' })
      return
    }

    session.data.questions.push(question)
    await sessions.set(sessionId, session)

    console.info('[resonance] Question added', { sessionId, questionId: question.id })
    void broadcast('resonance:question-added', { question }, sessionId)
    res.json({ ok: true, question })
  })

  // POST /api/resonance/:sessionId/annotate-response
  // Updates the private instructor annotation on a single response.
  app.post('/api/resonance/:sessionId/annotate-response', async (req, res) => {
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const responseId = typeof body.responseId === 'string' ? body.responseId : null
    if (!responseId || !session.data.responses.some((r) => r.id === responseId)) {
      res.status(400).json({ error: 'invalid responseId' })
      return
    }

    const patch = isPlainObject(body.annotation) ? body.annotation : {}
    const existing = session.data.annotations[responseId] ?? {
      starred: false,
      flagged: false,
      emoji: null,
    }

    const updated: InstructorAnnotation = {
      starred: typeof patch.starred === 'boolean' ? patch.starred : existing.starred,
      flagged: typeof patch.flagged === 'boolean' ? patch.flagged : existing.flagged,
      emoji:
        'emoji' in patch
          ? (typeof patch.emoji === 'string' ? patch.emoji : null)
          : existing.emoji,
    }

    session.data.annotations[responseId] = updated
    await sessions.set(sessionId, session)

    res.json({ ok: true, responseId, annotation: updated })
  })

  // POST /api/resonance/:sessionId/share-results
  // Creates a QuestionReveal broadcasting selected responses to all students.
  app.post('/api/resonance/:sessionId/share-results', async (req, res) => {
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const questionId = typeof body.questionId === 'string' ? body.questionId : null
    if (!questionId || !session.data.questions.some((q) => q.id === questionId)) {
      res.status(400).json({ error: 'invalid questionId' })
      return
    }

    const selectedIds = Array.isArray(body.selectedResponseIds)
      ? body.selectedResponseIds.filter((id): id is string => typeof id === 'string')
      : []

    const correctOptionIds =
      body.correctOptionIds === null
        ? null
        : Array.isArray(body.correctOptionIds)
          ? body.correctOptionIds.filter((id): id is string => typeof id === 'string')
          : null

    const now = Date.now()

    // Build shared responses — include instructor emoji only (no stars/flags).
    const sharedResponses = selectedIds
      .map((id) => session.data.responses.find((r) => r.id === id))
      .filter((r): r is Response => r !== undefined)
      .map((r) => ({
        id: r.id,
        questionId: r.questionId,
        answer: r.answer,
        sharedAt: now,
        instructorEmoji: session.data.annotations[r.id]?.emoji ?? null,
        reactions: {} as Record<string, number>,
      }))

    // Replace any existing reveal for this question.
    const existingIndex = session.data.reveals.findIndex((rv) => rv.questionId === questionId)
    const reveal: QuestionReveal = {
      questionId,
      sharedAt: now,
      correctOptionIds,
      sharedResponses,
    }

    if (existingIndex !== -1) {
      session.data.reveals[existingIndex] = reveal
    } else {
      session.data.reveals.push(reveal)
    }

    await sessions.set(sessionId, session)

    console.info('[resonance] Results shared', {
      sessionId,
      questionId,
      sharedCount: sharedResponses.length,
      correctOptionIds,
    })

    // Strip isCorrect from question options before broadcasting to students.
    const question = session.data.questions.find((q) => q.id === questionId)
    const studentSafeQuestion =
      question?.type === 'multiple-choice'
        ? { ...question, options: question.options.map(({ id, text }) => ({ id, text })) }
        : question

    void broadcast('resonance:results-shared', { reveal, question: studentSafeQuestion }, sessionId)
    res.json({ ok: true, reveal })
  })

  // POST /api/resonance/:sessionId/reorder-responses
  // Sets the display order of responses for a given question (instructor private view).
  app.post('/api/resonance/:sessionId/reorder-responses', async (req, res) => {
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const questionId = typeof body.questionId === 'string' ? body.questionId : null
    if (!questionId) {
      res.status(400).json({ error: 'missing questionId' })
      return
    }

    const orderedIds = Array.isArray(body.orderedResponseIds)
      ? body.orderedResponseIds.filter((id): id is string => typeof id === 'string')
      : []

    session.data.responseOrderOverrides[questionId] = orderedIds
    await sessions.set(sessionId, session)

    res.json({ ok: true })
  })

  // POST /api/resonance/:sessionId/update-question-timer
  // Sets or clears the response time limit on a question.
  app.post('/api/resonance/:sessionId/update-question-timer', async (req, res) => {
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const questionId = typeof body.questionId === 'string' ? body.questionId : null
    const timeLimitMs =
      body.timeLimitMs === null
        ? null
        : typeof body.timeLimitMs === 'number' && body.timeLimitMs > 0
          ? Math.round(body.timeLimitMs)
          : undefined

    if (!questionId || timeLimitMs === undefined) {
      res.status(400).json({ error: 'questionId and timeLimitMs (number or null) are required' })
      return
    }

    const question = session.data.questions.find((q) => q.id === questionId)
    if (!question) {
      res.status(404).json({ error: 'question not found' })
      return
    }

    question.responseTimeLimitMs = timeLimitMs
    await sessions.set(sessionId, session)

    console.info('[resonance] Question timer updated', { sessionId, questionId, timeLimitMs })
    void broadcast('resonance:question-timer-updated', { questionId, timeLimitMs }, sessionId)
    res.json({ ok: true, questionId, timeLimitMs })
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

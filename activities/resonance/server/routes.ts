import { timingSafeEqual } from 'crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import {
  findHashBySessionId,
  generatePersistentHash,
  verifyTeacherCodeWithHash,
} from 'activebits-server/core/persistentSessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  InstructorAnnotation,
  Question,
  QuestionReveal,
  Response,
  ResponseProgress,
  Student,
} from '../shared/types.js'
import { isValidStudentReactionEmoji } from '../shared/emojiSet.js'
import { validateAnswerPayload, validateQuestion, validateQuestionSet, validateStudentRegistration } from '../shared/validation.js'
import { decryptQuestions, encryptQuestions, MAX_ENCODED_PAYLOAD_CHARS } from './questionCrypto.js'
import {
  buildResonanceReport,
  buildResonanceReportFilename,
  buildResonanceReportHtml,
} from './reportRenderer.js'

// ---------------------------------------------------------------------------
// Route-level types
// ---------------------------------------------------------------------------

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
  send?(payload: unknown): void
  setHeader?(name: string, value: string): void
  cookie?(name: string, value: string, options: Record<string, unknown>): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
  headers?: Record<string, string | undefined>
  query?: Record<string, unknown>
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
  selfPacedMode?: boolean
  questions: Question[]
  activeQuestionId: string | null
  activeQuestionIds: string[]
  activeQuestionRunStartedAt: number | null
  activeQuestionDeadlineAt: number | null
  students: Record<string, Student>
  responses: Response[]
  responseDrafts: Record<string, {
    questionId: string
    studentId: string
    updatedAt: number
    answer: Response['answer']
  }>
  annotations: Record<string, InstructorAnnotation>
  reveals: QuestionReveal[]
  sharedResponseReactions: Record<string, Record<string, string>>
  responseOrderOverrides: Record<string, string[]>
  /** Stored when session is created from a persistent link — used for passcode recovery. */
  persistentHash: string | null
  embeddedParentSessionId?: string
  embeddedInstanceKey?: string
  embeddedLaunch?: Record<string, unknown>
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
  selectedOptions?: Record<string, string>
  entryPolicy?: string
  urlHash?: string
}

function prepareResonanceLinkOptions(body: Record<string, unknown>):
  | { ok: true; selectedOptions: { q: string; h: string } }
  | { ok: false; status: number; payload: { error: string; details?: string[] } } {
  const teacherCode = typeof body.teacherCode === 'string' ? body.teacherCode.trim() : ''
  if (teacherCode.length < 6) {
    return { ok: false, status: 400, payload: { error: 'teacherCode must be at least 6 characters' } }
  }
  if (teacherCode.length > 100) {
    return { ok: false, status: 400, payload: { error: 'teacherCode must be at most 100 characters' } }
  }

  if (!Array.isArray(body.questions)) {
    return { ok: false, status: 400, payload: { error: 'questions must be an array' } }
  }

  const { questions, errors } = validateQuestionSet(body.questions)
  if (errors.length > 0) {
    return { ok: false, status: 400, payload: { error: errors[0] ?? 'invalid question set', details: errors } }
  }
  if (questions.length === 0) {
    return { ok: false, status: 400, payload: { error: 'question set must not be empty' } }
  }

  // The payload decryption hash is activity-specific and distinct from the
  // shared persistent permalink hash that the platform signs around this data.
  const { hash } = generatePersistentHash('resonance', teacherCode)
  const { encoded, sizeChars } = encryptQuestions(questions, hash)

  if (sizeChars > MAX_ENCODED_PAYLOAD_CHARS) {
    return {
      ok: false,
      status: 422,
      payload: {
        error: `Question set is too large for a persistent link (${sizeChars} chars, limit ${MAX_ENCODED_PAYLOAD_CHARS})`,
      },
    }
  }

  return {
    ok: true,
    selectedOptions: { q: encoded, h: hash },
  }
}

interface EmbeddedParentSessionContext {
  parentSessionId: string
  activityName: 'syncdeck'
}

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
      ...(isPlainObject(entry.selectedOptions) ? { selectedOptions: entry.selectedOptions as Record<string, string> } : {}),
      ...(typeof entry.entryPolicy === 'string' ? { entryPolicy: entry.entryPolicy } : {}),
      ...(typeof entry.urlHash === 'string' ? { urlHash: entry.urlHash } : {}),
    }))
}

function readEmbeddedParentSessionContext(data: ResonanceSessionData): EmbeddedParentSessionContext | null {
  const parentSessionId = typeof data.embeddedParentSessionId === 'string'
    ? data.embeddedParentSessionId.trim()
    : ''
  if (!parentSessionId) {
    return null
  }

  return {
    parentSessionId,
    activityName: 'syncdeck',
  }
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

function normalizeInstructorPasscode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeActiveQuestionIds(
  value: unknown,
  fallbackActiveQuestionId: string | null,
): string[] {
  const ids = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : fallbackActiveQuestionId
      ? [fallbackActiveQuestionId]
      : []

  return Array.from(new Set(ids))
}

function normalizeActiveQuestionDeadlineAt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const rounded = Math.round(value)
  return rounded > 0 ? rounded : null
}

function isSyncDeckStandaloneSession(value: unknown): boolean {
  const record = ensurePlainObject(value)
  return record.standaloneMode === true
}

function setActiveQuestions(
  sessionData: ResonanceSessionData,
  questionIds: string[],
  runStartedAt: number | null,
  deadlineAt: number | null,
): void {
  sessionData.activeQuestionIds = questionIds
  sessionData.activeQuestionId = questionIds[0] ?? null
  sessionData.activeQuestionRunStartedAt = questionIds.length > 0 ? runStartedAt : null
  sessionData.activeQuestionDeadlineAt = questionIds.length > 0 ? deadlineAt : null
}

function clearActiveQuestions(sessionData: ResonanceSessionData): void {
  setActiveQuestions(sessionData, [], null, null)
}

function getOrderedExistingQuestionIds(
  questions: Question[],
  requestedQuestionIds: string[],
): string[] {
  const requested = new Set(requestedQuestionIds)
  return questions.filter((question) => requested.has(question.id)).map((question) => question.id)
}

function buildActiveQuestionRun(
  questions: Question[],
  questionIds: string[],
  now: number,
): { questionIds: string[]; deadlineAt: number | null } {
  const orderedQuestionIds = getOrderedExistingQuestionIds(questions, questionIds)
  if (orderedQuestionIds.length === 0) {
    return { questionIds: [], deadlineAt: null }
  }

  const totalTimeLimitMs = orderedQuestionIds.reduce((sum, questionId) => {
    const question = questions.find((entry) => entry.id === questionId)
    const timeLimitMs = question?.responseTimeLimitMs
    return typeof timeLimitMs === 'number' && timeLimitMs > 0 ? sum + timeLimitMs : sum
  }, 0)

  return {
    questionIds: orderedQuestionIds,
    deadlineAt: totalTimeLimitMs > 0 ? now + totalTimeLimitMs : null,
  }
}

function upsertResponse(
  responses: Response[],
  questionId: string,
  studentId: string,
  answer: Response['answer'],
): Response {
  const existing = responses.find(
    (response) => response.questionId === questionId && response.studentId === studentId,
  )
  const submittedAt = Date.now()

  if (existing) {
    existing.answer = answer
    existing.submittedAt = submittedAt
    return existing
  }

  const response: Response = {
    id: `r_${Math.random().toString(36).slice(2, 12)}`,
    questionId,
    studentId,
    submittedAt,
    answer,
  }
  responses.push(response)
  return response
}

function clearAllReveals(sessionData: ResonanceSessionData): QuestionReveal[] {
  const removedReveals = [...sessionData.reveals]
  sessionData.reveals = []
  sessionData.sharedResponseReactions = {}
  return removedReveals
}

function expireActiveQuestionRunIfNeeded(session: ResonanceSession): boolean {
  const deadlineAt = session.data.activeQuestionDeadlineAt
  if (deadlineAt === null || Date.now() < deadlineAt) {
    return false
  }

  clearActiveQuestions(session.data)
  return true
}

function resolveRequestedActiveQuestionIds(body: Record<string, unknown>): string[] | null | undefined {
  if (body.questionId === null) {
    return null
  }

  if (Array.isArray(body.questionIds)) {
    return body.questionIds
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  }

  if (typeof body.questionId === 'string') {
    return [body.questionId]
  }

  return undefined
}

function buildDraftKey(questionId: string, studentId: string): string {
  return `${questionId}:${studentId}`
}

function normalizeDraftAnswerPayload(
  value: unknown,
  questionsById: Map<string, Question>,
  questionId: string,
): Response['answer'] | null {
  const question = questionsById.get(questionId)
  if (!question) {
    return null
  }
  return validateAnswerPayload(value, question)
}

function normalizeResponseDrafts(
  value: unknown,
  questions: Question[],
): ResonanceSessionData['responseDrafts'] {
  if (!isPlainObject(value)) {
    return {}
  }

  const questionsById = new Map(questions.map((question) => [question.id, question] satisfies [string, Question]))
  const drafts: ResonanceSessionData['responseDrafts'] = {}

  for (const [key, rawDraft] of Object.entries(value)) {
    if (!isPlainObject(rawDraft)) {
      continue
    }

    const questionId = typeof rawDraft.questionId === 'string' ? rawDraft.questionId : ''
    const studentId = typeof rawDraft.studentId === 'string' ? rawDraft.studentId : ''
    const updatedAt = typeof rawDraft.updatedAt === 'number' && Number.isFinite(rawDraft.updatedAt)
      ? Math.round(rawDraft.updatedAt)
      : 0
    const answer = normalizeDraftAnswerPayload(rawDraft.answer, questionsById, questionId)

    if (!questionId || !studentId || updatedAt <= 0 || answer === null) {
      continue
    }

    drafts[key] = {
      questionId,
      studentId,
      updatedAt,
      answer,
    }
  }

  return drafts
}

function normalizeSessionData(data: unknown): ResonanceSessionData {
  const source = ensurePlainObject(data)

  let questions: Question[] = Array.isArray(source.questions) ? (source.questions as Question[]) : []
  let persistentHash: string | null = typeof source.persistentHash === 'string' ? source.persistentHash : null
  let normalizedEmbeddedLaunch = isPlainObject(source.embeddedLaunch)
    ? { ...(source.embeddedLaunch as Record<string, unknown>) }
    : null
  const embeddedLaunchSelectedOptions = normalizedEmbeddedLaunch && isPlainObject(normalizedEmbeddedLaunch.selectedOptions)
    ? { ...(normalizedEmbeddedLaunch.selectedOptions as Record<string, unknown>) }
    : null
  const shouldAutoActivateAllQuestions = embeddedLaunchSelectedOptions?.autoActivateAllQuestions === true
  if (embeddedLaunchSelectedOptions && 'autoActivateAllQuestions' in embeddedLaunchSelectedOptions) {
    delete embeddedLaunchSelectedOptions.autoActivateAllQuestions
    normalizedEmbeddedLaunch = {
      ...normalizedEmbeddedLaunch,
      selectedOptions: embeddedLaunchSelectedOptions,
    }
  }

  // When the platform WS creates a session from a persistent link, it stores
  // the encrypted question set and hash in embeddedLaunch.selectedOptions.
  if (questions.length === 0 && embeddedLaunchSelectedOptions) {
    const embedded = ensurePlainObject(embeddedLaunchSelectedOptions)
    const encodedQ = typeof embedded.q === 'string' ? embedded.q : null
    const embeddedHash = typeof embedded.h === 'string' ? embedded.h : null
    if (encodedQ !== null && embeddedHash !== null) {
      const decrypted = decryptQuestions(encodedQ, embeddedHash)
      if (decrypted !== null && decrypted.length > 0) {
        questions = decrypted
        persistentHash = embeddedHash
      }
    }

    if (questions.length === 0 && Array.isArray(embedded.questions)) {
      const validatedQuestionSet = validateQuestionSet(embedded.questions)
      if (validatedQuestionSet.errors.length === 0 && validatedQuestionSet.questions.length > 0) {
        questions = validatedQuestionSet.questions
      }
    }
  }

  const fallbackActiveQuestionId = typeof source.activeQuestionId === 'string' ? source.activeQuestionId : null
  let activeQuestionIds = normalizeActiveQuestionIds(source.activeQuestionIds, fallbackActiveQuestionId)
  let activeQuestionRunStartedAt =
    activeQuestionIds.length > 0 &&
    typeof source.activeQuestionRunStartedAt === 'number' &&
    Number.isFinite(source.activeQuestionRunStartedAt)
      ? Math.round(source.activeQuestionRunStartedAt)
      : null
  let activeQuestionDeadlineAt =
    activeQuestionIds.length > 0 ? normalizeActiveQuestionDeadlineAt(source.activeQuestionDeadlineAt) : null

  if (shouldAutoActivateAllQuestions && activeQuestionIds.length === 0 && questions.length > 0) {
    const runStartedAt = Date.now()
    const run = buildActiveQuestionRun(questions, questions.map((question) => question.id), runStartedAt)
    activeQuestionIds = run.questionIds
    activeQuestionRunStartedAt = run.questionIds.length > 0 ? runStartedAt : null
    activeQuestionDeadlineAt = run.questionIds.length > 0 ? run.deadlineAt : null
  }

  return {
    ...source,
    // Embedded child launches (for example from SyncDeck) create the raw session
    // without going through /create, so ensure a stable instructor passcode exists
    // before the child manager bootstrap is generated.
    instructorPasscode: normalizeInstructorPasscode(source.instructorPasscode) ?? generatePasscode(),
    ...(source.selfPacedMode === true ? { selfPacedMode: true } : {}),
    ...(normalizedEmbeddedLaunch ? { embeddedLaunch: normalizedEmbeddedLaunch } : {}),
    questions,
    activeQuestionId: activeQuestionIds[0] ?? null,
    activeQuestionIds,
    activeQuestionRunStartedAt,
    activeQuestionDeadlineAt,
    students: isPlainObject(source.students) ? (source.students as Record<string, Student>) : {},
    responses: Array.isArray(source.responses) ? (source.responses as Response[]) : [],
    responseDrafts: normalizeResponseDrafts(source.responseDrafts, questions),
    annotations: isPlainObject(source.annotations)
      ? (source.annotations as Record<string, InstructorAnnotation>)
      : {},
    reveals: Array.isArray(source.reveals) ? (source.reveals as QuestionReveal[]) : [],
    sharedResponseReactions: isPlainObject(source.sharedResponseReactions)
      ? (source.sharedResponseReactions as Record<string, Record<string, string>>)
      : {},
    responseOrderOverrides: isPlainObject(source.responseOrderOverrides)
      ? (source.responseOrderOverrides as Record<string, string[]>)
      : {},
    persistentHash,
  }
}

function asResonanceSession(session: SessionRecord | null): ResonanceSession | null {
  if (!session || session.type !== 'resonance') return null
  session.data = normalizeSessionData(session.data)
  return session as ResonanceSession
}

// ---------------------------------------------------------------------------
// Snapshot builders (produce student-safe and instructor-safe views)
// ---------------------------------------------------------------------------

function toStudentQuestion(q: Question) {
  if (q.type === 'free-response') return q
  return { ...q, options: q.options.map(({ id, text }) => ({ id, text })) }
}

function buildStudentReveal(
  reveal: QuestionReveal,
  session: ResonanceSession,
  viewerStudentId: string | null,
): QuestionReveal {
  const sharedResponses = reveal.sharedResponses.map((sharedResponse) => {
    const ownerResponse = session.data.responses.find((response) => response.id === sharedResponse.id)
    return {
      ...sharedResponse,
      isOwnResponse: viewerStudentId !== null && ownerResponse?.studentId === viewerStudentId,
      viewerReaction:
        viewerStudentId !== null
          ? session.data.sharedResponseReactions[sharedResponse.id]?.[viewerStudentId] ?? null
          : null,
    }
  })

  if (viewerStudentId === null) {
    return {
      ...reveal,
      sharedResponses,
      viewerResponse: null,
    }
  }

  const viewerResponse = session.data.responses.find(
    (response) => response.questionId === reveal.questionId && response.studentId === viewerStudentId,
  )

  return {
    ...reveal,
    sharedResponses,
    viewerResponse: viewerResponse
      ? {
          answer: viewerResponse.answer,
          submittedAt: viewerResponse.submittedAt,
          instructorEmoji: session.data.annotations[viewerResponse.id]?.emoji ?? null,
          isShared: sharedResponses.some((sharedResponse) => sharedResponse.id === viewerResponse.id),
        }
      : null,
  }
}

function buildSelfPacedMcqReveals(
  session: ResonanceSession,
  viewerStudentId: string | null,
  existingRevealedQuestionIds: Set<string>,
): QuestionReveal[] {
  if (viewerStudentId === null) {
    return []
  }

  const viewerResponses = session.data.responses.filter((response) => response.studentId === viewerStudentId)
  if (viewerResponses.length < session.data.questions.length) {
    return []
  }

  const responsesByQuestionId = new Map(
    viewerResponses.map((response) => [response.questionId, response] satisfies [string, Response]),
  )
  if (session.data.questions.some((question) => !responsesByQuestionId.has(question.id))) {
    return []
  }

  return session.data.questions.flatMap((question) => {
    if (question.type !== 'multiple-choice' || existingRevealedQuestionIds.has(question.id)) {
      return []
    }

    const correctOptionIds = question.options
      .filter((option) => option.isCorrect === true)
      .map((option) => option.id)
    if (correctOptionIds.length === 0) {
      return []
    }

    const viewerResponse = responsesByQuestionId.get(question.id)
    if (!viewerResponse || viewerResponse.answer.type !== 'multiple-choice') {
      return []
    }

    return [{
      questionId: question.id,
      sharedAt: viewerResponse.submittedAt,
      correctOptionIds,
      sharedResponses: [],
      viewerResponse: {
        answer: viewerResponse.answer,
        submittedAt: viewerResponse.submittedAt,
        instructorEmoji: session.data.annotations[viewerResponse.id]?.emoji ?? null,
        isShared: false,
      },
    } satisfies QuestionReveal]
  })
}

function buildStudentSnapshotWithMode(
  session: ResonanceSession,
  viewerStudentId: string | null,
  selfPacedMode: boolean,
) {
  const { activeQuestionId, activeQuestionIds, activeQuestionRunStartedAt, activeQuestionDeadlineAt, questions, reveals } = session.data
  const effectiveSelfPacedMode = selfPacedMode && activeQuestionIds.length === 0
  const fallbackQuestionIds = effectiveSelfPacedMode
    ? questions.map((question) => question.id)
    : activeQuestionIds
  const fallbackQuestions = effectiveSelfPacedMode
    ? questions.map(toStudentQuestion)
    : questions
      .filter((question) => activeQuestionIds.includes(question.id))
      .map(toStudentQuestion)
  const liveActiveQuestionIdSet = new Set(activeQuestionIds)
  const activeQuestions = fallbackQuestions
  const activeQuestion = activeQuestions[0] ?? null
  const revealedQuestionIds = new Set(reveals.map((r) => r.questionId))
  const selfPacedReveals = effectiveSelfPacedMode
    ? buildSelfPacedMcqReveals(session, viewerStudentId, revealedQuestionIds)
    : []
  for (const reveal of selfPacedReveals) {
    revealedQuestionIds.add(reveal.questionId)
  }
  const revealedQuestions = questions.filter((q) => revealedQuestionIds.has(q.id)).map(toStudentQuestion)
  const submittedAnswers =
    viewerStudentId === null
      ? {}
      : Object.fromEntries(
          session.data.responses
            .filter((response) => response.studentId === viewerStudentId)
            .map((response) => [response.questionId, response.answer] satisfies [string, Response['answer']]),
        )
  const reviewedResponses =
    viewerStudentId === null
      ? []
      : session.data.responses
        .filter((response) => response.studentId === viewerStudentId)
        .map((response) => {
          const emoji = session.data.annotations[response.id]?.emoji ?? null
          const question = questions.find((entry) => entry.id === response.questionId)
          return emoji !== null &&
            question !== undefined &&
            !revealedQuestionIds.has(response.questionId) &&
            !liveActiveQuestionIdSet.has(response.questionId)
            ? {
                question: toStudentQuestion(question),
                answer: response.answer,
                submittedAt: response.submittedAt,
                instructorEmoji: emoji,
              }
            : null
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((left, right) => right.submittedAt - left.submittedAt)
  return {
    sessionId: session.id,
    selfPacedMode: effectiveSelfPacedMode,
    activeQuestion: activeQuestionId !== null ? (activeQuestions.find((q) => q.id === activeQuestionId) ?? activeQuestion) : activeQuestion,
    activeQuestions,
    activeQuestionIds: fallbackQuestionIds,
    activeQuestionRunStartedAt: effectiveSelfPacedMode ? null : activeQuestionRunStartedAt,
    activeQuestionDeadlineAt: effectiveSelfPacedMode ? null : activeQuestionDeadlineAt,
    reveals: [
      ...reveals.map((reveal) => buildStudentReveal(reveal, session, viewerStudentId)),
      ...selfPacedReveals,
    ],
    reviewedResponses,
    submittedAnswers,
    revealedQuestions,
  }
}

function buildInstructorSnapshot(session: ResonanceSession) {
  const {
    questions,
    activeQuestionId,
    activeQuestionIds,
    activeQuestionRunStartedAt,
    activeQuestionDeadlineAt,
    students,
    responses,
    responseDrafts,
    annotations,
    reveals,
    responseOrderOverrides,
  } =
    session.data
  const activeQuestionIdSet = new Set(activeQuestionIds)
  const currentRunSubmittedKeys = new Set<string>()
  const progressByQuestionStudent = new Map<string, ResponseProgress>()

  for (const response of responses) {
    const key = buildDraftKey(response.questionId, response.studentId)
    const isStaleActiveResponse =
      activeQuestionIdSet.has(response.questionId) &&
      activeQuestionRunStartedAt !== null &&
      response.submittedAt < activeQuestionRunStartedAt

    if (!isStaleActiveResponse) {
      currentRunSubmittedKeys.add(key)
    }

    progressByQuestionStudent.set(key, {
      questionId: response.questionId,
      studentId: response.studentId,
      studentName: students[response.studentId]?.name ?? 'Unknown',
      updatedAt: response.submittedAt,
      status: isStaleActiveResponse ? 'working' : 'submitted',
      answer: response.answer,
      responseId: response.id,
    })
  }

  for (const draft of Object.values(responseDrafts)) {
    const key = buildDraftKey(draft.questionId, draft.studentId)
    if (currentRunSubmittedKeys.has(key)) {
      continue
    }

    progressByQuestionStudent.set(key, {
      questionId: draft.questionId,
      studentId: draft.studentId,
      studentName: students[draft.studentId]?.name ?? 'Unknown',
      updatedAt: draft.updatedAt,
      status: 'working',
      answer: draft.answer,
      responseId: null,
    })
  }

  for (const question of questions) {
    for (const student of Object.values(students)) {
      const key = buildDraftKey(question.id, student.studentId)
      if (progressByQuestionStudent.has(key) || responseDrafts[key] !== undefined) {
        continue
      }

      progressByQuestionStudent.set(key, {
        questionId: question.id,
        studentId: student.studentId,
        studentName: student.name,
        updatedAt: student.joinedAt,
        status: 'idle',
        answer: null,
        responseId: null,
      })
    }
  }

  const progress = [...progressByQuestionStudent.values()]

  return {
    sessionId: session.id,
    questions,
    activeQuestionId,
    activeQuestionIds,
    activeQuestionRunStartedAt,
    activeQuestionDeadlineAt,
    students: Object.values(students),
    responses: responses.map((r) => ({
      ...r,
      studentName: students[r.studentId]?.name ?? 'Unknown',
    })),
    progress,
    annotations,
    reveals,
    responseOrderOverrides,
  }
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

async function resolveSelfPacedMode(
  session: ResonanceSession,
  sessions: Pick<SessionStore, 'get'>,
): Promise<boolean> {
  if (session.data.selfPacedMode === true) {
    return true
  }

  const embeddedParentContext = readEmbeddedParentSessionContext(session.data)
  if (!embeddedParentContext) {
    return false
  }

  const parentSession = await sessions.get(embeddedParentContext.parentSessionId)
  if (!parentSession || parentSession.type !== embeddedParentContext.activityName) {
    return false
  }

  const resolved = embeddedParentContext.activityName === 'syncdeck' && isSyncDeckStandaloneSession(parentSession.data)
  if (resolved) {
    session.data.selfPacedMode = true
  }

  return resolved
}

function resolveStudentAvailableQuestionIds(session: ResonanceSession, selfPacedMode: boolean): string[] {
  if (selfPacedMode && session.data.activeQuestionIds.length === 0) {
    return session.data.questions.map((question) => question.id)
  }

  return session.data.activeQuestionIds
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
  async function loadResonanceSession(sessionId: string): Promise<ResonanceSession | null> {
    const session = asResonanceSession(await sessions.get(sessionId))
    if (!session) {
      return null
    }

    const hadSelfPacedMode = session.data.selfPacedMode === true
    const resolvedSelfPacedMode =
      hadSelfPacedMode
        ? true
        : await resolveSelfPacedMode(session, sessions)
    if (expireActiveQuestionRunIfNeeded(session)) {
      await sessions.set(sessionId, session)
    } else if (!hadSelfPacedMode && resolvedSelfPacedMode && session.data.selfPacedMode === true) {
      await sessions.set(sessionId, session)
    }

    return session
  }

  function sendToSocket(socket: ResonanceSocket, type: string, payload: unknown, sessionId: string): void {
    if (socket.readyState !== 1) return
    try {
      socket.send(
        JSON.stringify({
          version: '1' as const,
          activity: 'resonance',
          sessionId,
          type,
          timestamp: Date.now(),
          payload,
        }),
      )
    } catch (err) {
      console.error('[resonance] Failed to send WS message', { sessionId, type, err })
    }
  }

  async function broadcast(type: string, payload: unknown, sessionId: string): Promise<void> {
    const clients = ws.wss.clients ?? new Set<ActiveBitsWebSocket>()
    for (const socket of clients as Set<ResonanceSocket>) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        sendToSocket(socket, type, payload, sessionId)
      }
    }
  }

  function broadcastToRole(
    type: string,
    payload: unknown,
    sessionId: string,
    isInstructor: boolean,
  ): void {
    const clients = ws.wss.clients ?? new Set<ActiveBitsWebSocket>()
    for (const socket of clients as Set<ResonanceSocket>) {
      if (
        socket.readyState === 1 &&
        socket.sessionId === sessionId &&
        socket.isInstructor === isInstructor
      ) {
        sendToSocket(socket, type, payload, sessionId)
      }
    }
  }

  async function broadcastStudentSessionState(session: ResonanceSession, sessionId: string): Promise<void> {
    try {
      const selfPacedMode = await resolveSelfPacedMode(session, sessions)
      const clients = ws.wss.clients ?? new Set<ActiveBitsWebSocket>()
      for (const socket of clients as Set<ResonanceSocket>) {
        if (
          socket.readyState === 1 &&
          socket.sessionId === sessionId &&
          socket.isInstructor !== true
        ) {
          sendToSocket(
            socket,
            'resonance:session-state',
            buildStudentSnapshotWithMode(session, socket.studentId ?? null, selfPacedMode),
            sessionId,
          )
        }
      }
    } catch (error) {
      console.error('[resonance] Failed to broadcast student session state', { sessionId, error })
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/resonance/create
  // Creates a new session. Optionally accepts encoded questions from a
  // persistent link so they can be pre-loaded into the session. Raw question
  // payloads are only honored for explicit self-paced standalone launches.
  // ---------------------------------------------------------------------------
  app.post('/api/resonance/create', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const instructorPasscode = generatePasscode()
    const selfPacedMode = body.selfPacedMode === true

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

    if (selfPacedMode && questions.length === 0 && Array.isArray(body.questions)) {
      const validatedQuestionSet = validateQuestionSet(body.questions)
      if (validatedQuestionSet.errors.length === 0 && validatedQuestionSet.questions.length > 0) {
        questions = validatedQuestionSet.questions
      }
    }

    if (selfPacedMode && questions.length === 0) {
      res.status(400).json({ error: 'self-paced Resonance launch requires a valid question payload' })
      return
    }

    const session = await createSession(sessions, {
      data: normalizeSessionData({
        instructorPasscode,
        questions,
        persistentHash,
        ...(selfPacedMode ? { selfPacedMode: true } : {}),
      }),
    })
    session.type = 'resonance'
    await sessions.set(session.id, session)

    console.info('[resonance] Session created', {
      sessionId: session.id,
      questionCount: questions.length,
      fromPersistentLink: persistentHash !== null,
      selfPacedMode,
    })

    res.json(selfPacedMode ? { id: session.id } : { id: session.id, instructorPasscode })
  })

  // ---------------------------------------------------------------------------
  // POST /api/resonance/prepare-link-options
  // Validates and encrypts a question set, returning activity-specific
  // selectedOptions that the shared persistent-session flow will sign.
  // ---------------------------------------------------------------------------
  app.post('/api/resonance/prepare-link-options', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const prepared = prepareResonanceLinkOptions(body)
    if (!prepared.ok) {
      res.status(prepared.status).json(prepared.payload)
      return
    }

    res.json({ selectedOptions: prepared.selectedOptions })
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

    const session = await loadResonanceSession(sessionId)
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }

    const directPersistentHash = session.data.persistentHash
    const embeddedParentContext = readEmbeddedParentSessionContext(session.data)
    const recoveryActivityName = directPersistentHash
      ? 'resonance'
      : embeddedParentContext?.activityName ?? null
    const recoverySessionId = directPersistentHash
      ? sessionId
      : embeddedParentContext?.parentSessionId ?? null
    const persistentHash = recoverySessionId
      ? await findHashBySessionId(recoverySessionId)
      : null

    if (!persistentHash || !recoveryActivityName) {
      res.status(403).json({ error: 'session was not created from a persistent link' })
      return
    }

    // Verify the teacher owns the direct persistent session or the embedded
    // parent SyncDeck session via their cookie.
    const cookieEntries = parsePersistentSessionsCookie(req.cookies?.persistent_sessions)
    const entry = cookieEntries.find((e) => e.key === `${recoveryActivityName}:${persistentHash}`)
    if (!entry) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const verified = verifyTeacherCodeWithHash(recoveryActivityName, persistentHash, entry.teacherCode)
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

    const session = await loadResonanceSession(sessionId)
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

    const session = await loadResonanceSession(sessionId)
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

    const selfPacedMode = await resolveSelfPacedMode(session, sessions)
    const availableQuestionIds = resolveStudentAvailableQuestionIds(session, selfPacedMode)
    const requestedQuestionId = typeof body.questionId === 'string' ? body.questionId : null
    const questionId =
      requestedQuestionId !== null
        ? requestedQuestionId
        : availableQuestionIds.length === 1
          ? availableQuestionIds[0] ?? null
          : session.data.activeQuestionId

    if (!questionId || !availableQuestionIds.includes(questionId)) {
      res.status(409).json({ error: 'no active question' })
      return
    }

    const activeQuestion = session.data.questions.find((q) => q.id === questionId) ?? null
    if (!activeQuestion) {
      res.status(409).json({ error: 'active question not found' })
      return
    }

    const answer = validateAnswerPayload(body.answer, activeQuestion)
    if (!answer) {
      res.status(400).json({ error: 'invalid answer payload' })
      return
    }

    upsertResponse(session.data.responses, questionId, studentId, answer)
    delete session.data.responseDrafts[buildDraftKey(questionId, studentId)]
    await sessions.set(sessionId, session)
    void broadcastStudentSessionState(session, sessionId)
    broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)

    console.info('[resonance] Answer submitted', { sessionId, studentId, questionId })
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

    const session = await loadResonanceSession(sessionId)
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }

    const requestedStudentId = typeof req.query?.studentId === 'string' ? req.query.studentId : null
    const selfPacedMode = await resolveSelfPacedMode(session, sessions)
    res.json(buildStudentSnapshotWithMode(session, requestedStudentId, selfPacedMode))
  })

  // GET /api/resonance/:sessionId/responses
  // Returns the full instructor session snapshot with student names and annotations.
  app.get('/api/resonance/:sessionId/responses', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await loadResonanceSession(sessionId)
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    res.json(buildInstructorSnapshot(session))
  })

  // POST /api/resonance/:sessionId/activate-question
  // Sets the active question set. Pass null to deactivate all.
  app.post('/api/resonance/:sessionId/activate-question', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await loadResonanceSession(sessionId)
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const body = isPlainObject(req.body) ? req.body : {}
    const requestedQuestionIds = resolveRequestedActiveQuestionIds(body)

    if (requestedQuestionIds === undefined) {
      res.status(400).json({ error: 'questionId must be a string or null, or questionIds must be an array of strings' })
      return
    }

    if (requestedQuestionIds !== null) {
      const orderedQuestionIds = getOrderedExistingQuestionIds(session.data.questions, requestedQuestionIds)
      if (orderedQuestionIds.length !== Array.from(new Set(requestedQuestionIds)).length) {
        res.status(404).json({ error: 'question not found' })
        return
      }
      const runStartedAt = Date.now()
      const run = buildActiveQuestionRun(session.data.questions, orderedQuestionIds, runStartedAt)
      setActiveQuestions(session.data, run.questionIds, runStartedAt, run.deadlineAt)
    } else {
      clearActiveQuestions(session.data)
    }

    if (requestedQuestionIds !== null && session.data.activeQuestionIds.length === 0) {
      res.status(404).json({ error: 'question not found' })
      return
    }
    await sessions.set(sessionId, session)

    console.info('[resonance] Question activation updated', {
      sessionId,
      activeQuestionIds: session.data.activeQuestionIds,
      activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
    })
    void broadcast(
      'resonance:question-activated',
      {
        questionId: session.data.activeQuestionId,
        questionIds: session.data.activeQuestionIds,
        deadlineAt: session.data.activeQuestionDeadlineAt,
      },
      sessionId,
    )
    res.json({
      ok: true,
      activeQuestionId: session.data.activeQuestionId,
      activeQuestionIds: session.data.activeQuestionIds,
      activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
    })
  })

  // POST /api/resonance/:sessionId/add-question
  // Adds a new question to the session's question set.
  app.post('/api/resonance/:sessionId/add-question', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await loadResonanceSession(sessionId)
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

    const session = await loadResonanceSession(sessionId)
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
    void broadcastStudentSessionState(session, sessionId)

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

    const reveal: QuestionReveal = {
      questionId,
      sharedAt: now,
      correctOptionIds,
      sharedResponses,
    }
    session.data.reveals = [reveal]
    session.data.sharedResponseReactions = {}

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

  // POST /api/resonance/:sessionId/stop-sharing
  // Removes any currently shared reveal.
  app.post('/api/resonance/:sessionId/stop-sharing', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await loadResonanceSession(sessionId)
    if (!session) {
      res.status(404).json({ error: 'session not found' })
      return
    }

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const removedReveals = clearAllReveals(session.data)
    if (removedReveals.length === 0) {
      res.status(404).json({ error: 'nothing is currently shared' })
      return
    }

    await sessions.set(sessionId, session)
    console.info('[resonance] Sharing stopped', {
      sessionId,
      questionId: removedReveals[0]?.questionId ?? null,
    })
    void broadcast('resonance:sharing-stopped', {}, sessionId)
    res.json({ ok: true })
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

  // ---------------------------------------------------------------------------
  // WS message handlers
  // ---------------------------------------------------------------------------

  async function handleInstructorWsMessage(
    session: ResonanceSession,
    type: string,
    payload: Record<string, unknown>,
    sessionId: string,
  ): Promise<void> {
    switch (type) {
      case 'resonance:activate-question': {
        const requestedQuestionIds = resolveRequestedActiveQuestionIds(payload)
        if (requestedQuestionIds === undefined) return
        if (requestedQuestionIds === null) {
          clearActiveQuestions(session.data)
        } else {
          const uniqueRequestedIds = Array.from(new Set(requestedQuestionIds))
          const orderedQuestionIds = getOrderedExistingQuestionIds(session.data.questions, uniqueRequestedIds)
          if (orderedQuestionIds.length !== uniqueRequestedIds.length) return
          const runStartedAt = Date.now()
          const run = buildActiveQuestionRun(session.data.questions, orderedQuestionIds, runStartedAt)
          setActiveQuestions(session.data, run.questionIds, runStartedAt, run.deadlineAt)
        }
        await sessions.set(sessionId, session)
        console.info('[resonance] WS activate-question', {
          sessionId,
          activeQuestionIds: session.data.activeQuestionIds,
          activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
        })
        void broadcast(
          'resonance:question-activated',
          {
            questionId: session.data.activeQuestionId,
            questionIds: session.data.activeQuestionIds,
            deadlineAt: session.data.activeQuestionDeadlineAt,
          },
          sessionId,
        )
        void broadcastStudentSessionState(session, sessionId)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:add-question': {
        const errors: string[] = []
        const question = validateQuestion(payload, errors)
        if (!question || errors.length > 0) return
        if (session.data.questions.some((q) => q.id === question.id)) return
        session.data.questions.push(question)
        await sessions.set(sessionId, session)
        console.info('[resonance] WS add-question', { sessionId, questionId: question.id })
        void broadcast('resonance:question-added', { question }, sessionId)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:share-results': {
        const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
        if (!questionId || !session.data.questions.some((q) => q.id === questionId)) return
        const selectedIds = Array.isArray(payload.selectedResponseIds)
          ? payload.selectedResponseIds.filter((id): id is string => typeof id === 'string')
          : []
        const correctOptionIds =
          payload.correctOptionIds === null
            ? null
            : Array.isArray(payload.correctOptionIds)
              ? payload.correctOptionIds.filter((id): id is string => typeof id === 'string')
              : null
        const now = Date.now()
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
        const reveal: QuestionReveal = { questionId, sharedAt: now, correctOptionIds, sharedResponses }
        session.data.reveals = [reveal]
        session.data.sharedResponseReactions = {}
        await sessions.set(sessionId, session)
        console.info('[resonance] WS share-results', {
          sessionId,
          questionId,
          sharedCount: sharedResponses.length,
        })
        const q = session.data.questions.find((sq) => sq.id === questionId)
        const studentSafeQ =
          q?.type === 'multiple-choice'
            ? { ...q, options: q.options.map(({ id, text }) => ({ id, text })) }
            : q
        void broadcast('resonance:results-shared', { reveal, question: studentSafeQ }, sessionId)
        void broadcastStudentSessionState(session, sessionId)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:stop-sharing': {
        const removedReveals = clearAllReveals(session.data)
        if (removedReveals.length === 0) return
        await sessions.set(sessionId, session)
        console.info('[resonance] WS stop-sharing', {
          sessionId,
          questionId: removedReveals[0]?.questionId ?? null,
        })
        void broadcast('resonance:sharing-stopped', {}, sessionId)
        void broadcastStudentSessionState(session, sessionId)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:annotate-response': {
        const responseId = typeof payload.responseId === 'string' ? payload.responseId : null
        if (!responseId || !session.data.responses.some((r) => r.id === responseId)) return
        const patch = isPlainObject(payload.annotation) ? payload.annotation : {}
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
              ? typeof patch.emoji === 'string'
                ? patch.emoji
                : null
              : existing.emoji,
        }
        session.data.annotations[responseId] = updated
        await sessions.set(sessionId, session)
        void broadcastStudentSessionState(session, sessionId)
        broadcastToRole(
          'resonance:annotation-updated',
          { responseId, annotation: updated },
          sessionId,
          true,
        )
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:update-question-timer': {
        const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
        const timeLimitMs =
          payload.timeLimitMs === null
            ? null
            : typeof payload.timeLimitMs === 'number' && payload.timeLimitMs > 0
              ? Math.round(payload.timeLimitMs)
              : undefined
        if (!questionId || timeLimitMs === undefined) return
        const q = session.data.questions.find((sq) => sq.id === questionId)
        if (!q) return
        q.responseTimeLimitMs = timeLimitMs
        await sessions.set(sessionId, session)
        console.info('[resonance] WS update-question-timer', { sessionId, questionId, timeLimitMs })
        void broadcast('resonance:question-timer-updated', { questionId, timeLimitMs }, sessionId)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:reorder-responses': {
        const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
        if (!questionId) return
        const orderedIds = Array.isArray(payload.orderedResponseIds)
          ? payload.orderedResponseIds.filter((id): id is string => typeof id === 'string')
          : []
        session.data.responseOrderOverrides[questionId] = orderedIds
        await sessions.set(sessionId, session)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      default:
        console.info('[resonance] Unknown instructor WS message type', { sessionId, type })
    }
  }

  async function handleStudentWsMessage(
    session: ResonanceSession,
    type: string,
    payload: Record<string, unknown>,
    sessionId: string,
    clientStudentId: string | null | undefined,
  ): Promise<void> {
    switch (type) {
      case 'resonance:submit-answer': {
        const studentId =
          typeof payload.studentId === 'string' ? payload.studentId : (clientStudentId ?? null)
        if (!studentId || !session.data.students[studentId]) return
        const requestedQuestionId = typeof payload.questionId === 'string' ? payload.questionId : null
        const selfPacedMode = await resolveSelfPacedMode(session, sessions)
        const availableQuestionIds = resolveStudentAvailableQuestionIds(session, selfPacedMode)
        const questionId =
          requestedQuestionId !== null
            ? requestedQuestionId
            : availableQuestionIds.length === 1
              ? (availableQuestionIds[0] ?? null)
              : session.data.activeQuestionId
        if (!questionId || !availableQuestionIds.includes(questionId)) return
        const activeQuestion = session.data.questions.find((q) => q.id === questionId) ?? null
        if (!activeQuestion) return
        const answer = validateAnswerPayload(payload.answer, activeQuestion)
        if (!answer) return
        const response = upsertResponse(session.data.responses, questionId, studentId, answer)
        delete session.data.responseDrafts[buildDraftKey(questionId, studentId)]
        await sessions.set(sessionId, session)
        console.info('[resonance] WS submit-answer', {
          sessionId,
          studentId,
          questionId,
        })
        const student = session.data.students[studentId]
        const responseWithName = { ...response, studentName: student?.name ?? 'Unknown' }
        broadcastToRole('resonance:response-received', { response: responseWithName }, sessionId, true)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        void broadcastStudentSessionState(session, sessionId)
        break
      }

      case 'resonance:update-draft': {
        const studentId =
          typeof payload.studentId === 'string' ? payload.studentId : (clientStudentId ?? null)
        if (!studentId || !session.data.students[studentId]) return
        const selfPacedMode = await resolveSelfPacedMode(session, sessions)
        const availableQuestionIds = resolveStudentAvailableQuestionIds(session, selfPacedMode)

        const questionId = typeof payload.questionId === 'string'
          ? payload.questionId
          : availableQuestionIds.length === 1
            ? (availableQuestionIds[0] ?? null)
            : session.data.activeQuestionId
        if (!questionId || !availableQuestionIds.includes(questionId)) return

        const question = session.data.questions.find((entry) => entry.id === questionId) ?? null
        if (!question) return

        const alreadyAnswered = session.data.responses.some(
          (response) => response.questionId === questionId && response.studentId === studentId,
        )
        if (alreadyAnswered) return

        const draftKey = buildDraftKey(questionId, studentId)
        if (payload.answer === null) {
          if (draftKey in session.data.responseDrafts) {
            delete session.data.responseDrafts[draftKey]
            await sessions.set(sessionId, session)
            broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
          }
          return
        }

        const answer = validateAnswerPayload(payload.answer, question)
        if (!answer) return

        session.data.responseDrafts[draftKey] = {
          questionId,
          studentId,
          updatedAt: Date.now(),
          answer,
        }
        await sessions.set(sessionId, session)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:react-to-shared': {
        const studentId = clientStudentId ?? null
        const sharedResponseId =
          typeof payload.sharedResponseId === 'string' ? payload.sharedResponseId : null
        const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
        const emoji = typeof payload.emoji === 'string' ? payload.emoji : null
        if (!studentId || !sharedResponseId || !questionId || !emoji || !isValidStudentReactionEmoji(emoji)) return
        const reveal = session.data.reveals.find((r) => r.questionId === questionId)
        if (!reveal) return
        const sharedResp = reveal.sharedResponses.find((sr) => sr.id === sharedResponseId)
        if (!sharedResp) return
        const reactionsByStudent = session.data.sharedResponseReactions[sharedResponseId] ?? {}
        const previousEmoji = reactionsByStudent[studentId] ?? null
        if (previousEmoji === emoji) return
        if (previousEmoji !== null) {
          const previousCount = sharedResp.reactions[previousEmoji] ?? 0
          if (previousCount <= 1) {
            delete sharedResp.reactions[previousEmoji]
          } else {
            sharedResp.reactions[previousEmoji] = previousCount - 1
          }
        }
        reactionsByStudent[studentId] = emoji
        session.data.sharedResponseReactions[sharedResponseId] = reactionsByStudent
        sharedResp.reactions[emoji] = (sharedResp.reactions[emoji] ?? 0) + 1
        await sessions.set(sessionId, session)
        void broadcast(
          'resonance:reaction-updated',
          { questionId, sharedResponseId, reactions: sharedResp.reactions },
          sessionId,
        )
        void broadcastStudentSessionState(session, sessionId)
        break
      }

      default:
        console.info('[resonance] Unknown student WS message type', { sessionId, type })
    }
  }

  // GET /api/resonance/:sessionId/report
  // Returns an HTML report by default; ?format=json returns the raw report object.
  // Requires instructor auth via X-Instructor-Passcode header.
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

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const report = buildResonanceReport({
      id: session.id,
      ...session.data,
    })

    const formatParam = isPlainObject(req.body)
      ? null
      : (req as unknown as { query?: Record<string, unknown> }).query?.format ?? null
    const wantsJson =
      formatParam === 'json' ||
      String(req.headers?.['accept'] ?? '').includes('application/json')

    if (wantsJson) {
      console.info('[resonance] Report JSON exported', { sessionId })
      res.json(report)
      return
    }

    const html = buildResonanceReportHtml(report)
    const filename = buildResonanceReportFilename(session.id)
    console.info('[resonance] Report HTML exported', { sessionId })
    res.setHeader?.('Content-Type', 'text/html; charset=utf-8')
    res.setHeader?.('Content-Disposition', `attachment; filename="${filename}"`)
    if (typeof res.send === 'function') {
      res.send(html)
      return
    }
    res.json(html)
  })

  // ---------------------------------------------------------------------------
  // WebSocket /ws/resonance
  // ---------------------------------------------------------------------------

  ws.register('/ws/resonance', (socket, queryParams) => {
    const client = socket as ResonanceSocket
    client.sessionId = queryParams.get('sessionId') ?? null
    client.isInstructor = false
    client.studentId = queryParams.get('studentId') ?? null

    const sessionId = client.sessionId
    if (!sessionId) {
      socket.close(1008, 'missing sessionId')
      return
    }

    void (async () => {
      const session = await loadResonanceSession(sessionId)
      if (!session) {
        socket.close(1008, 'invalid session')
        return
      }

      const role = queryParams.get('role')
      const instructorPasscode = queryParams.get('instructorPasscode')

      if (role === 'instructor') {
        if (
          !instructorPasscode ||
          !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)
        ) {
          socket.close(1008, 'invalid instructor passcode')
          return
        }
        client.isInstructor = true
        sendToSocket(client, 'resonance:instructor-state', buildInstructorSnapshot(session), sessionId)
      } else {
        const selfPacedMode = await resolveSelfPacedMode(session, sessions)
        sendToSocket(
          client,
          'resonance:session-state',
          buildStudentSnapshotWithMode(session, client.studentId ?? null, selfPacedMode),
          sessionId,
        )
      }

      console.info('[resonance] WebSocket connected', {
        sessionId,
        role: client.isInstructor ? 'instructor' : 'student',
        studentId: client.studentId,
      })

      socket.on('message', (...args: unknown[]) => {
        const [rawMessage] = args
        void (async () => {
          try {
            const data = JSON.parse(String(rawMessage)) as { type?: unknown; payload?: unknown }
            const msgType = typeof data.type === 'string' ? data.type : null
            const msgPayload = isPlainObject(data.payload) ? data.payload : {}
            if (!msgType) return

            const sess = await loadResonanceSession(sessionId)
            if (!sess) {
              socket.close(1011, 'session expired')
              return
            }

            if (client.isInstructor) {
              await handleInstructorWsMessage(sess, msgType, msgPayload, sessionId)
            } else {
              await handleStudentWsMessage(sess, msgType, msgPayload, sessionId, client.studentId)
            }
          } catch (err) {
            console.error('[resonance] WS message handler error', { sessionId, err })
          }
        })()
      })

      socket.on('close', () => {
        console.info('[resonance] WebSocket disconnected', {
          sessionId,
          role: client.isInstructor ? 'instructor' : 'student',
        })
      })
    })().catch((err) => {
      console.error('[resonance] WS connection setup failed', { sessionId, err })
      socket.close(1011, 'setup failed')
    })
  })
}

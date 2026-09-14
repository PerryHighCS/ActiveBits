import { timingSafeEqual } from 'crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import {
  getActivityCapabilityCookieName,
  tryIssueActivityCapability,
  readCookieValue,
  resolveActivityPrincipalFromCookies,
  writeActivityCapabilityCookie,
} from 'activebits-server/core/activityCapabilities.js'
import {
  getSessionParticipantCookieName,
  revokeAcceptedEntryParticipant,
  resolveAcceptedEntryParticipantToken,
} from 'activebits-server/core/acceptedEntryParticipants.js'
import { registerActivityReportBuilder } from '../../../server/activities/activityReportRegistry.js'
import {
  findHashBySessionId,
  generatePersistentHash,
  recordRateLimitAttemptStrict,
  verifyTeacherCodeWithHash,
} from 'activebits-server/core/persistentSessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  InstructorAnnotation,
  Question,
  QuestionReveal,
  ResonancePresentationMode,
  Response,
  ResponseProgress,
  StagedRunState,
  Student,
} from '../shared/types.js'
import { isValidStudentReactionEmoji } from '../shared/emojiSet.js'
import { getCorrectOptionIds, getMcqSelectionMode } from '../shared/mcq.js'
import { normalizePresentationMode, validateAnswerPayload, validateQuestion, validateQuestionSet, validateStudentRegistration } from '../shared/validation.js'
import { decryptQuestions, encryptQuestions, MAX_ENCODED_PAYLOAD_CHARS } from './questionCrypto.js'
import {
  buildResonanceReport,
  buildResonanceReportFilename,
  buildResonanceReportHtml,
  buildResonanceStructuredReportSection,
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
  ip?: unknown
}

interface ResonanceRouteApp {
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface DeadlineTaskHandle {
  unref?(): void
}

interface DeadlineTaskRunner {
  now(): number
  schedule(callback: () => void, delayMs: number): DeadlineTaskHandle
  cancel(handle: DeadlineTaskHandle): void
}

const defaultDeadlineTaskRunner: DeadlineTaskRunner = {
  now: Date.now,
  schedule(callback, delayMs) {
    return setTimeout(callback, delayMs)
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

interface ResonanceSocket extends ActiveBitsWebSocket {
  sessionId?: string | null
  isInstructor?: boolean
  studentId?: string | null
}

const MAX_SET_TIMEOUT_MS = 2_147_483_647
const DEADLINE_TASK_RETRY_MS = 1_000
// A classroom commonly shares one NAT address, so this must accommodate a
// whole class joining together while still leaving half the 200-record pool
// unavailable to one unauthenticated burst.
const MAX_UNAUTHENTICATED_DIRECT_REGISTRATIONS_PER_MINUTE = 100

function getRegistrationRateLimitKey(sessionId: string, ip: unknown): string {
  // Express derives req.ip from trusted proxy configuration. A raw forwarding
  // header is caller-controlled and must not create separate limiter buckets.
  const clientAddress = typeof ip === 'string' && ip.length > 0 ? ip : 'unknown'
  return `resonance:direct-registration:${sessionId}:${clientAddress}`
}

export function scheduleParticipantCapabilityExpiryClose(
  client: ResonanceSocket,
  session: ResonanceSession,
  capabilityId: string,
): void {
  // The caller reaches here only after awaiting session/self-paced-mode
  // lookups, so the socket may have already closed. Its 'close' event has
  // then already fired, so the listener registered below would never run to
  // clear the timer — leaking a reference to this socket for up to the
  // capability's whole TTL on every connect/disconnect race. Bail before
  // arming anything.
  if (client.readyState !== 1) return

  const record = (session.data as { activityCapabilities?: Record<string, { expiresAt?: unknown }> })
    .activityCapabilities?.[capabilityId]
  const expiresAt = record?.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return

  let timer: ReturnType<typeof setTimeout> | undefined
  const closeExpired = (): void => {
    try {
      client.close(1008, 'participant authentication required')
    } catch {
      // Socket is already closing.
    }
  }
  const arm = (): void => {
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      closeExpired()
      return
    }
    timer = setTimeout(remaining <= MAX_SET_TIMEOUT_MS ? closeExpired : arm, Math.min(remaining, MAX_SET_TIMEOUT_MS))
    timer.unref?.()
  }
  arm()
  client.on('close', () => {
    if (timer) clearTimeout(timer)
  })
}

// ---------------------------------------------------------------------------
// Session data shape
// ---------------------------------------------------------------------------

interface ResonanceSessionData extends Record<string, unknown> {
  instructorPasscode: string
  selfPacedMode?: boolean
  presentationMode: ResonancePresentationMode
  stagedRun: StagedRunState | null
  questions: Question[]
  activeQuestionId: string | null
  activeQuestionIds: string[]
  activeQuestionRunStartedAt: number | null
  activeQuestionRunRevision: number | null
  lastActiveQuestionRunRevision: number
  activeQuestionDeadlineAt: number | null
  embeddedAutoActivatedAt?: number | null
  students: Record<string, Student>
  responses: Response[]
  responseDrafts: Record<string, {
    questionId: string
    studentId: string
    updatedAt: number
    activeQuestionRunRevision?: number | null
    editSequence?: number
    draftGeneration?: number
    answer: Response['answer']
  }>
  // Retain the generation after a clear so a delayed older write cannot
  // recreate the draft. Entries are scoped by run revision.
  responseDraftGenerations: Record<string, {
    questionId: string
    studentId: string
    activeQuestionRunRevision?: number | null
    draftGeneration: number
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
    selectedOptions: {
      q: encoded,
      h: hash,
      ...(normalizePresentationMode(body.presentationMode) === 'staged' ? { presentationMode: 'staged' } : {}),
    },
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

function normalizeStagedRunState(value: unknown, availableQuestionIds: string[]): StagedRunState | null {
  if (!isPlainObject(value)) {
    return null
  }

  const availableQuestionIdSet = new Set(availableQuestionIds)
  const seenQuestionIds = new Set<string>()
  const questionIds = Array.isArray(value.questionIds)
    ? value.questionIds.filter((entry): entry is string => {
        if (typeof entry !== 'string' || entry.trim().length === 0 || !availableQuestionIdSet.has(entry)) {
          return false
        }
        if (seenQuestionIds.has(entry)) {
          return false
        }
        seenQuestionIds.add(entry)
        return true
      })
    : []
  if (questionIds.length === 0) {
    return null
  }

  const completedQuestionIds = Array.isArray(value.completedQuestionIds)
    ? value.completedQuestionIds.filter((entry): entry is string => (
        typeof entry === 'string' &&
        questionIds.includes(entry)
      ))
    : []
  const requestedCurrentQuestionId = typeof value.currentQuestionId === 'string' ? value.currentQuestionId : null
  const fallbackCurrentIndex = typeof value.currentIndex === 'number' && Number.isFinite(value.currentIndex)
    ? Math.max(0, Math.min(questionIds.length - 1, Math.round(value.currentIndex)))
    : 0
  const currentIndex = requestedCurrentQuestionId !== null && questionIds.includes(requestedCurrentQuestionId)
    ? questionIds.indexOf(requestedCurrentQuestionId)
    : fallbackCurrentIndex
  const currentQuestionId = questionIds[currentIndex] ?? null

  return {
    questionIds,
    currentQuestionId,
    currentIndex,
    choicesRevealed: value.choicesRevealed === true,
    completedQuestionIds: Array.from(new Set(completedQuestionIds)),
  }
}

function createStagedRunState(questionIds: string[]): StagedRunState | null {
  const normalizedQuestionIds = questionIds.filter((questionId) => questionId.trim().length > 0)
  if (normalizedQuestionIds.length === 0) {
    return null
  }

  return {
    questionIds: normalizedQuestionIds,
    currentQuestionId: normalizedQuestionIds[0] ?? null,
    currentIndex: 0,
    choicesRevealed: false,
    completedQuestionIds: [],
  }
}

function isSyncDeckStandaloneSession(value: unknown): boolean {
  const record = ensurePlainObject(value)
  return record.standaloneMode === true
}

function setActiveQuestions(
  sessionData: ResonanceSessionData,
  questionIds: string[],
  runStartedAt: number | null,
  runRevision: number | null,
  deadlineAt: number | null,
): void {
  sessionData.stagedRun = null
  sessionData.activeQuestionIds = questionIds
  sessionData.activeQuestionId = questionIds[0] ?? null
  sessionData.activeQuestionRunStartedAt = questionIds.length > 0 ? runStartedAt : null
  sessionData.activeQuestionRunRevision = questionIds.length > 0 ? runRevision : null
  if (runRevision !== null) sessionData.lastActiveQuestionRunRevision = runRevision
  sessionData.activeQuestionDeadlineAt = questionIds.length > 0 ? deadlineAt : null
}

function clearActiveQuestions(sessionData: ResonanceSessionData): void {
  setActiveQuestions(sessionData, [], null, null, null)
}

function setStagedActiveQuestion(
  sessionData: ResonanceSessionData,
  stagedRun: StagedRunState,
  runStartedAt: number | null,
  runRevision: number | null,
  deadlineAt: number | null,
): void {
  sessionData.stagedRun = stagedRun
  sessionData.activeQuestionIds = stagedRun.currentQuestionId ? [stagedRun.currentQuestionId] : []
  sessionData.activeQuestionId = stagedRun.currentQuestionId
  sessionData.activeQuestionRunStartedAt = runStartedAt
  sessionData.activeQuestionRunRevision = runRevision
  if (runRevision !== null) sessionData.lastActiveQuestionRunRevision = runRevision
  sessionData.activeQuestionDeadlineAt = deadlineAt
}

function nextActiveQuestionRunRevision(sessionData: ResonanceSessionData): number {
  return Math.max(
    sessionData.lastActiveQuestionRunRevision,
    sessionData.activeQuestionRunRevision ?? 0,
  ) + 1
}

function clearStagedRun(sessionData: ResonanceSessionData): void {
  sessionData.stagedRun = null
  clearActiveQuestions(sessionData)
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

function buildSingleQuestionDeadline(question: Question | null, now: number): number | null {
  const timeLimitMs = question?.responseTimeLimitMs
  return typeof timeLimitMs === 'number' && timeLimitMs > 0 ? now + timeLimitMs : null
}

function getQuestionById(questions: Question[], questionId: string | null): Question | null {
  return questionId === null ? null : (questions.find((question) => question.id === questionId) ?? null)
}

type QuestionAnswerability =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'choices-hidden' | 'inactive' }

function getQuestionAnswerability(sessionData: ResonanceSessionData, questionId: string): QuestionAnswerability {
  if (sessionData.activeQuestionDeadlineAt !== null && Date.now() >= sessionData.activeQuestionDeadlineAt) {
    return { ok: false, reason: 'expired' }
  }

  const stagedRun = sessionData.stagedRun
  if (sessionData.presentationMode !== 'staged' || stagedRun === null) {
    return { ok: true }
  }
  if (stagedRun.currentQuestionId !== questionId) {
    return { ok: false, reason: 'inactive' }
  }
  const question = getQuestionById(sessionData.questions, questionId)
  return question?.type !== 'multiple-choice' || stagedRun.choicesRevealed
    ? { ok: true }
    : { ok: false, reason: 'choices-hidden' }
}

function matchesActiveQuestionRun(
  sessionData: ResonanceSessionData,
  revision: unknown,
  legacyStartedAt: unknown,
): boolean {
  if (typeof revision === 'number' && Number.isSafeInteger(revision)) {
    return revision === sessionData.activeQuestionRunRevision
  }
  if (
    revision == null &&
    legacyStartedAt == null &&
    sessionData.activeQuestionRunRevision === null &&
    sessionData.activeQuestionRunStartedAt === null
  ) {
    return true
  }
  return sessionData.activeQuestionRunRevision === 1 && legacyStartedAt === sessionData.activeQuestionRunStartedAt
}

export function resolveAnswerabilityErrorMessage(reason: 'expired' | 'choices-hidden' | 'inactive'): string {
  switch (reason) {
    case 'expired':
      return 'time is up for this question'
    case 'inactive':
      return 'question is not active'
    case 'choices-hidden':
      return 'choices have not been revealed'
  }
}

function isCurrentStagedQuestionAnswerable(sessionData: ResonanceSessionData, questionId: string): boolean {
  return getQuestionAnswerability(sessionData, questionId).ok
}

function startStagedRun(
  sessionData: ResonanceSessionData,
  questionIds: string[],
  now: number,
): StagedRunState | null {
  const stagedRun = createStagedRunState(questionIds)
  if (stagedRun === null) {
    clearStagedRun(sessionData)
    return null
  }

  const currentQuestion = getQuestionById(sessionData.questions, stagedRun.currentQuestionId)
  const choicesRevealed = currentQuestion?.type !== 'multiple-choice'
  const nextRun = { ...stagedRun, choicesRevealed }
  const runRevision = nextActiveQuestionRunRevision(sessionData)
  setStagedActiveQuestion(
    sessionData,
    nextRun,
    now,
    runRevision,
    choicesRevealed ? buildSingleQuestionDeadline(currentQuestion, now) : null,
  )
  return nextRun
}

function buildActivationPayload(sessionData: ResonanceSessionData) {
  return {
    questionId: sessionData.activeQuestionId,
    questionIds: sessionData.activeQuestionIds,
    deadlineAt: sessionData.activeQuestionDeadlineAt,
    presentationMode: sessionData.presentationMode,
    stagedRun: sessionData.stagedRun,
  }
}

function upsertResponse(
  responses: Response[],
  questionId: string,
  studentId: string,
  answer: Response['answer'],
  activeQuestionRunRevision: number | null,
  editSequence = 0,
): Response {
  const existing = responses.find(
    (response) => response.questionId === questionId && response.studentId === studentId,
  )
  const submittedAt = Date.now()

  if (existing) {
    existing.answer = answer
    existing.submittedAt = submittedAt
    existing.activeQuestionRunRevision = activeQuestionRunRevision
    existing.editSequence = editSequence
    return existing
  }

  const response: Response = {
    id: `r_${Math.random().toString(36).slice(2, 12)}`,
    questionId,
    studentId,
    submittedAt,
    activeQuestionRunRevision,
    editSequence,
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

interface DraftFinalizationResult {
  changed: boolean
  finalizedDraftCount: number
}

function draftMatchesCurrentRun(
  sessionData: ResonanceSessionData,
  draft: ResonanceSessionData['responseDrafts'][string],
): boolean {
  const runStartedAt = sessionData.activeQuestionRunStartedAt
  const runRevision = sessionData.activeQuestionRunRevision
  return draft.activeQuestionRunRevision !== undefined
    ? draft.activeQuestionRunRevision === runRevision
    // Pre-revision drafts remain visible for legacy/self-paced snapshots that
    // have no run revision. Once a numbered run exists, use the migration
    // timestamp guard so an older unversioned draft cannot cross into it.
    : runRevision === null || (runRevision === 1 && runStartedAt !== null && draft.updatedAt >= runStartedAt)
}

function finalizeActiveQuestionDrafts(
  sessionData: ResonanceSessionData,
  deadlineAt: number,
): DraftFinalizationResult {
  const activeQuestionIds = new Set(sessionData.activeQuestionIds)
  const runStartedAt = sessionData.activeQuestionRunStartedAt
  let changed = false
  let finalizedCount = 0

  for (const [draftKey, draft] of Object.entries(sessionData.responseDrafts)) {
    if (!activeQuestionIds.has(draft.questionId)) {
      continue
    }

    if (
      sessionData.students[draft.studentId] !== undefined &&
      runStartedAt !== null &&
      draft.updatedAt <= deadlineAt &&
      draftMatchesCurrentRun(sessionData, draft)
    ) {
      upsertResponse(
        sessionData.responses,
        draft.questionId,
        draft.studentId,
        draft.answer,
        sessionData.activeQuestionRunRevision,
        draft.editSequence ?? 0,
      )
      finalizedCount += 1
    }
    delete sessionData.responseDrafts[draftKey]
    changed = true
  }

  return { changed, finalizedDraftCount: finalizedCount }
}

function expireActiveQuestionRunIfNeeded(
  session: ResonanceSession,
  now = Date.now(),
): DraftFinalizationResult {
  const deadlineAt = session.data.activeQuestionDeadlineAt
  if (deadlineAt === null || now < deadlineAt) {
    return { changed: false, finalizedDraftCount: 0 }
  }

  const result = finalizeActiveQuestionDrafts(session.data, deadlineAt)
  const { finalizedDraftCount } = result
  if (finalizedDraftCount > 0) {
    console.info(JSON.stringify({
      component: 'resonance',
      event: 'drafts-finalized-at-timeout',
      sessionId: session.id,
      finalizedDraftCount,
    }))
  }
  if (session.data.stagedRun !== null) {
    return result
  }

  clearActiveQuestions(session.data)
  return { changed: true, finalizedDraftCount }
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

function resolveEditSequence(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function resolveDraftGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function resolveSocketStudentId(payloadStudentId: unknown, clientStudentId: string | null | undefined): string | null {
  const studentId = clientStudentId ?? null
  if (!studentId || (typeof payloadStudentId === 'string' && payloadStudentId !== studentId)) {
    return null
  }
  return studentId
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

function normalizeStoredResponses(
  value: unknown,
  questions: Question[],
): Response[] {
  if (!Array.isArray(value)) {
    return []
  }

  const questionsById = new Map(questions.map((question) => [question.id, question] satisfies [string, Question]))
  const responses: Response[] = []

  for (const rawResponse of value) {
    if (!isPlainObject(rawResponse)) {
      continue
    }

    const id = typeof rawResponse.id === 'string' ? rawResponse.id : ''
    const questionId = typeof rawResponse.questionId === 'string' ? rawResponse.questionId : ''
    const studentId = typeof rawResponse.studentId === 'string' ? rawResponse.studentId : ''
    const submittedAt =
      typeof rawResponse.submittedAt === 'number' && Number.isFinite(rawResponse.submittedAt)
        ? Math.round(rawResponse.submittedAt)
        : 0
    const answer = normalizeDraftAnswerPayload(rawResponse.answer, questionsById, questionId)
    const activeQuestionRunRevision = rawResponse.activeQuestionRunRevision === null
      ? null
      : typeof rawResponse.activeQuestionRunRevision === 'number' &&
          Number.isSafeInteger(rawResponse.activeQuestionRunRevision) &&
          rawResponse.activeQuestionRunRevision > 0
        ? rawResponse.activeQuestionRunRevision
        : undefined
    const editSequence = resolveEditSequence(rawResponse.editSequence)

    if (!id || !questionId || !studentId || submittedAt <= 0 || answer === null) {
      continue
    }

    responses.push({
      id,
      questionId,
      studentId,
      submittedAt,
      ...(activeQuestionRunRevision !== undefined ? { activeQuestionRunRevision } : {}),
      editSequence,
      answer,
    })
  }

  return responses
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
    const activeQuestionRunRevision = rawDraft.activeQuestionRunRevision === null
      ? null
      : typeof rawDraft.activeQuestionRunRevision === 'number' &&
          Number.isSafeInteger(rawDraft.activeQuestionRunRevision) &&
          rawDraft.activeQuestionRunRevision > 0
        ? rawDraft.activeQuestionRunRevision
        : undefined
    const answer = normalizeDraftAnswerPayload(rawDraft.answer, questionsById, questionId)
    const editSequence = resolveEditSequence(rawDraft.editSequence)
    const draftGeneration = resolveDraftGeneration(rawDraft.draftGeneration)

    if (!questionId || !studentId || updatedAt <= 0 || answer === null) {
      continue
    }

    drafts[key] = {
      questionId,
      studentId,
      updatedAt,
      ...(activeQuestionRunRevision !== undefined ? { activeQuestionRunRevision } : {}),
      editSequence,
      ...(draftGeneration > 0 ? { draftGeneration } : {}),
      answer,
    }
  }

  return drafts
}

function normalizeResponseDraftGenerations(value: unknown): ResonanceSessionData['responseDraftGenerations'] {
  if (!isPlainObject(value)) return {}
  const generations: ResonanceSessionData['responseDraftGenerations'] = {}
  for (const [key, rawGeneration] of Object.entries(value)) {
    if (!isPlainObject(rawGeneration)) continue
    const questionId = typeof rawGeneration.questionId === 'string' ? rawGeneration.questionId : ''
    const studentId = typeof rawGeneration.studentId === 'string' ? rawGeneration.studentId : ''
    const draftGeneration = resolveDraftGeneration(rawGeneration.draftGeneration)
    if (!questionId || !studentId || draftGeneration === 0) continue
    const activeQuestionRunRevision = rawGeneration.activeQuestionRunRevision === null
      ? null
      : typeof rawGeneration.activeQuestionRunRevision === 'number' &&
          Number.isSafeInteger(rawGeneration.activeQuestionRunRevision) && rawGeneration.activeQuestionRunRevision > 0
        ? rawGeneration.activeQuestionRunRevision
        : undefined
    generations[key] = {
      questionId,
      studentId,
      ...(activeQuestionRunRevision !== undefined ? { activeQuestionRunRevision } : {}),
      draftGeneration,
    }
  }
  return generations
}

function normalizeSharedResponseReactions(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) {
    return {}
  }

  const reactions: Record<string, number> = {}
  for (const [emoji, count] of Object.entries(value)) {
    if (!isValidStudentReactionEmoji(emoji)) {
      continue
    }

    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      continue
    }

    reactions[emoji] = count
  }

  return reactions
}

function normalizeStoredReveals(
  value: unknown,
  questions: Question[],
): QuestionReveal[] {
  if (!Array.isArray(value)) {
    return []
  }

  const questionsById = new Map(questions.map((question) => [question.id, question] satisfies [string, Question]))
  const reveals: QuestionReveal[] = []

  for (const rawReveal of value) {
    if (!isPlainObject(rawReveal)) {
      continue
    }

    const questionId = typeof rawReveal.questionId === 'string' ? rawReveal.questionId : ''
    const sharedAt =
      typeof rawReveal.sharedAt === 'number' && Number.isFinite(rawReveal.sharedAt)
        ? Math.round(rawReveal.sharedAt)
        : 0
    const question = questionsById.get(questionId)

    if (!questionId || sharedAt <= 0 || !question) {
      continue
    }

    const correctOptionIds =
      rawReveal.correctOptionIds === null
        ? null
        : Array.isArray(rawReveal.correctOptionIds) &&
            rawReveal.correctOptionIds.every((entry) => typeof entry === 'string')
          ? rawReveal.correctOptionIds
          : null

    const sharedResponses = Array.isArray(rawReveal.sharedResponses)
      ? rawReveal.sharedResponses.flatMap((rawSharedResponse) => {
          if (!isPlainObject(rawSharedResponse)) {
            return []
          }

          const id = typeof rawSharedResponse.id === 'string' ? rawSharedResponse.id : ''
          const sharedQuestionId = typeof rawSharedResponse.questionId === 'string' ? rawSharedResponse.questionId : ''
          const sharedResponseAt =
            typeof rawSharedResponse.sharedAt === 'number' && Number.isFinite(rawSharedResponse.sharedAt)
              ? Math.round(rawSharedResponse.sharedAt)
              : 0
          const answer = normalizeDraftAnswerPayload(rawSharedResponse.answer, questionsById, questionId)

          if (!id || sharedQuestionId !== questionId || sharedResponseAt <= 0 || answer === null) {
            return []
          }

          return [{
            id,
            questionId: sharedQuestionId,
            answer,
            sharedAt: sharedResponseAt,
            instructorEmoji: typeof rawSharedResponse.instructorEmoji === 'string' ? rawSharedResponse.instructorEmoji : null,
            reactions: normalizeSharedResponseReactions(rawSharedResponse.reactions),
          }]
        })
      : []

    const viewerResponse = isPlainObject(rawReveal.viewerResponse)
      ? (() => {
          const submittedAt =
            typeof rawReveal.viewerResponse.submittedAt === 'number' && Number.isFinite(rawReveal.viewerResponse.submittedAt)
              ? Math.round(rawReveal.viewerResponse.submittedAt)
              : 0
          const answer = normalizeDraftAnswerPayload(rawReveal.viewerResponse.answer, questionsById, questionId)

          if (submittedAt <= 0 || answer === null) {
            return null
          }

          return {
            answer,
            submittedAt,
            instructorEmoji:
              typeof rawReveal.viewerResponse.instructorEmoji === 'string'
                ? rawReveal.viewerResponse.instructorEmoji
                : null,
            isShared: rawReveal.viewerResponse.isShared === true,
          }
        })()
      : null

    reveals.push({
      questionId,
      sharedAt,
      correctOptionIds,
      sharedResponses,
      ...(viewerResponse !== null ? { viewerResponse } : {}),
    })
  }

  return reveals
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
  const presentationMode = normalizePresentationMode(
    embeddedLaunchSelectedOptions?.presentationMode ?? source.presentationMode,
  )
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
  let activeQuestionRunRevision =
    activeQuestionIds.length > 0 &&
    typeof source.activeQuestionRunRevision === 'number' &&
    Number.isSafeInteger(source.activeQuestionRunRevision) &&
    source.activeQuestionRunRevision > 0
      ? source.activeQuestionRunRevision
      : activeQuestionIds.length > 0 ? 1 : null
  let lastActiveQuestionRunRevision =
    typeof source.lastActiveQuestionRunRevision === 'number' &&
    Number.isSafeInteger(source.lastActiveQuestionRunRevision) &&
    source.lastActiveQuestionRunRevision >= 0
      ? source.lastActiveQuestionRunRevision
      : activeQuestionRunRevision ?? 0
  lastActiveQuestionRunRevision = Math.max(lastActiveQuestionRunRevision, activeQuestionRunRevision ?? 0)
  let activeQuestionDeadlineAt =
    activeQuestionIds.length > 0 ? normalizeActiveQuestionDeadlineAt(source.activeQuestionDeadlineAt) : null
  let stagedRun = presentationMode === 'staged'
    ? normalizeStagedRunState(source.stagedRun, questions.map((question) => question.id))
    : null
  let embeddedAutoActivatedAt =
    typeof source.embeddedAutoActivatedAt === 'number' && Number.isFinite(source.embeddedAutoActivatedAt)
      ? Math.round(source.embeddedAutoActivatedAt)
      : null

  if (
    shouldAutoActivateAllQuestions
    && embeddedAutoActivatedAt === null
    && activeQuestionIds.length === 0
    && questions.length > 0
  ) {
    const runStartedAt = Date.now()
    const runRevision = lastActiveQuestionRunRevision + 1
    lastActiveQuestionRunRevision = runRevision
    const orderedQuestionIds = questions.map((question) => question.id)
    if (presentationMode === 'staged') {
      stagedRun = createStagedRunState(orderedQuestionIds)
      const currentQuestion = getQuestionById(questions, stagedRun?.currentQuestionId ?? null)
      const startsImmediately = currentQuestion?.type !== 'multiple-choice'
      if (stagedRun && startsImmediately) {
        stagedRun = { ...stagedRun, choicesRevealed: true }
      }
      activeQuestionIds = stagedRun?.currentQuestionId ? [stagedRun.currentQuestionId] : []
      activeQuestionRunStartedAt = activeQuestionIds.length > 0 ? runStartedAt : null
      activeQuestionRunRevision = activeQuestionIds.length > 0 ? runRevision : null
      activeQuestionDeadlineAt = startsImmediately ? buildSingleQuestionDeadline(currentQuestion, runStartedAt) : null
      embeddedAutoActivatedAt = activeQuestionIds.length > 0 ? runStartedAt : null
    } else {
      const run = buildActiveQuestionRun(questions, orderedQuestionIds, runStartedAt)
      activeQuestionIds = run.questionIds
      activeQuestionRunStartedAt = run.questionIds.length > 0 ? runStartedAt : null
      activeQuestionRunRevision = run.questionIds.length > 0 ? runRevision : null
      activeQuestionDeadlineAt = run.questionIds.length > 0 ? run.deadlineAt : null
      embeddedAutoActivatedAt = run.questionIds.length > 0 ? runStartedAt : null
    }
  }

  if (stagedRun !== null) {
    const currentQuestion = getQuestionById(questions, stagedRun.currentQuestionId)
    activeQuestionIds = stagedRun.currentQuestionId ? [stagedRun.currentQuestionId] : []
    if (activeQuestionIds.length > 0 && activeQuestionRunStartedAt === null) {
      activeQuestionRunStartedAt = Date.now()
    }
    if (activeQuestionIds.length > 0 && activeQuestionRunRevision === null) {
      activeQuestionRunRevision = lastActiveQuestionRunRevision + 1
      lastActiveQuestionRunRevision = activeQuestionRunRevision
    }
    if (currentQuestion?.type === 'multiple-choice' && !stagedRun.choicesRevealed) {
      activeQuestionDeadlineAt = null
    }
  }

  return {
    ...source,
    // Embedded child launches (for example from SyncDeck) create the raw session
    // without going through /create, so ensure a stable instructor passcode exists
    // before the child manager bootstrap is generated.
    instructorPasscode: normalizeInstructorPasscode(source.instructorPasscode) ?? generatePasscode(),
    ...(source.selfPacedMode === true ? { selfPacedMode: true } : {}),
    ...(normalizedEmbeddedLaunch ? { embeddedLaunch: normalizedEmbeddedLaunch } : {}),
    presentationMode,
    stagedRun,
    questions,
    activeQuestionId: stagedRun?.currentQuestionId ?? activeQuestionIds[0] ?? null,
    activeQuestionIds,
    activeQuestionRunStartedAt,
    activeQuestionRunRevision,
    lastActiveQuestionRunRevision,
    activeQuestionDeadlineAt,
    ...(embeddedAutoActivatedAt !== null ? { embeddedAutoActivatedAt } : {}),
    students: isPlainObject(source.students) ? (source.students as Record<string, Student>) : {},
    responses: normalizeStoredResponses(source.responses, questions),
    responseDrafts: normalizeResponseDrafts(source.responseDrafts, questions),
    responseDraftGenerations: normalizeResponseDraftGenerations(source.responseDraftGenerations),
    annotations: isPlainObject(source.annotations)
      ? (source.annotations as Record<string, InstructorAnnotation>)
      : {},
    reveals: normalizeStoredReveals(source.reveals, questions),
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

function toStudentQuestion(q: Question, choicesRevealed = true) {
  if (q.type === 'free-response') return q
  return {
    ...q,
    options: choicesRevealed ? q.options.map(({ id, text }) => ({ id, text })) : [],
    selectionMode: getMcqSelectionMode(q),
    choicesRevealed,
  }
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

    const correctOptionIds = getCorrectOptionIds(question.options)
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

function areChoicesVisibleToStudents(sessionData: ResonanceSessionData, question: Question): boolean {
  if (question.type !== 'multiple-choice') {
    return true
  }
  const stagedRun = sessionData.stagedRun
  if (sessionData.presentationMode !== 'staged' || stagedRun === null) {
    return true
  }
  return stagedRun.currentQuestionId !== question.id || stagedRun.choicesRevealed
}

function toStudentQuestionForSession(sessionData: ResonanceSessionData, question: Question) {
  return toStudentQuestion(question, areChoicesVisibleToStudents(sessionData, question))
}

function buildStudentSnapshotWithMode(
  session: ResonanceSession,
  viewerStudentId: string | null,
  selfPacedMode: boolean,
) {
  const { activeQuestionId, activeQuestionIds, activeQuestionRunStartedAt, activeQuestionRunRevision, activeQuestionDeadlineAt, questions, reveals } = session.data
  const effectiveSelfPacedMode = selfPacedMode && activeQuestionIds.length === 0
  const fallbackQuestionIds = effectiveSelfPacedMode
    ? questions.map((question) => question.id)
    : activeQuestionIds
  const fallbackQuestions = effectiveSelfPacedMode
    ? questions.map((question) => toStudentQuestionForSession(session.data, question))
    : questions
      .filter((question) => activeQuestionIds.includes(question.id))
      .map((question) => toStudentQuestionForSession(session.data, question))
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
  const revealedQuestions = questions.filter((q) => revealedQuestionIds.has(q.id)).map((question) => toStudentQuestion(question))
  const submittedAnswers =
    viewerStudentId === null
      ? {}
      : Object.fromEntries(
          session.data.responses
            .filter((response) => response.studentId === viewerStudentId)
            .map((response) => [response.questionId, response.answer] satisfies [string, Response['answer']]),
        )
  const submittedResponseEditSequences =
    viewerStudentId === null
      ? {}
      : Object.fromEntries(
          session.data.responses
            .filter((response) => response.studentId === viewerStudentId)
            .map((response) => [response.questionId, response.editSequence ?? 0] satisfies [string, number]),
        )
  const draftGenerations = viewerStudentId === null
    ? {}
    : Object.fromEntries(
        Object.entries(session.data.responseDraftGenerations)
          .flatMap(([, generation]) => {
            return generation.studentId === viewerStudentId &&
              generation.activeQuestionRunRevision === session.data.activeQuestionRunRevision
              ? [[generation.questionId, generation.draftGeneration] satisfies [string, number]]
              : []
          }),
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
    presentationMode: session.data.presentationMode,
    stagedRun: effectiveSelfPacedMode ? null : session.data.stagedRun,
    activeQuestion: activeQuestionId !== null ? (activeQuestions.find((q) => q.id === activeQuestionId) ?? activeQuestion) : activeQuestion,
    activeQuestions,
    activeQuestionIds: fallbackQuestionIds,
    activeQuestionRunStartedAt: effectiveSelfPacedMode ? null : activeQuestionRunStartedAt,
    activeQuestionRunRevision: effectiveSelfPacedMode ? null : activeQuestionRunRevision,
    activeQuestionDeadlineAt: effectiveSelfPacedMode ? null : activeQuestionDeadlineAt,
    lastActiveQuestionRunRevision:
      session.data.lastActiveQuestionRunRevision > 0 ? session.data.lastActiveQuestionRunRevision : null,
    reveals: [
      ...reveals.map((reveal) => buildStudentReveal(reveal, session, viewerStudentId)),
      ...selfPacedReveals,
    ],
    reviewedResponses,
    submittedAnswers,
    submittedResponseEditSequences,
    draftGenerations,
    revealedQuestions,
  }
}

function isStaleActiveResponse(
  sessionData: ResonanceSessionData,
  response: Response,
  activeQuestionIdSet?: ReadonlySet<string>,
): boolean {
  return (
    (activeQuestionIdSet?.has(response.questionId) ?? sessionData.activeQuestionIds.includes(response.questionId)) &&
    sessionData.activeQuestionRunRevision !== null &&
    (response.activeQuestionRunRevision !== undefined
      ? response.activeQuestionRunRevision !== sessionData.activeQuestionRunRevision
      : sessionData.activeQuestionRunStartedAt !== null && response.submittedAt < sessionData.activeQuestionRunStartedAt)
  )
}

function buildInstructorSnapshot(session: ResonanceSession) {
  const {
    presentationMode,
    stagedRun,
    questions,
    activeQuestionId,
    activeQuestionIds,
    activeQuestionRunStartedAt,
    activeQuestionRunRevision,
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
  const currentRunSubmittedEditSequences = new Map<string, number>()
  const progressByQuestionStudent = new Map<string, ResponseProgress>()
  const visibleDraftKeys = new Set<string>()

  for (const response of responses) {
    const key = buildDraftKey(response.questionId, response.studentId)
    const staleActiveResponse = isStaleActiveResponse(session.data, response, activeQuestionIdSet)

    if (!staleActiveResponse) {
      currentRunSubmittedEditSequences.set(key, response.editSequence ?? 0)
    }

    progressByQuestionStudent.set(key, {
      questionId: response.questionId,
      studentId: response.studentId,
      studentName: students[response.studentId]?.name ?? 'Unknown',
      updatedAt: response.submittedAt,
      status: staleActiveResponse ? 'working' : 'submitted',
      answer: response.answer,
      responseId: response.id,
    })
  }

  for (const draft of Object.values(responseDrafts)) {
    const key = buildDraftKey(draft.questionId, draft.studentId)
    if (!draftMatchesCurrentRun(session.data, draft)) {
      continue
    }
    const confirmedEditSequence = currentRunSubmittedEditSequences.get(key)
    if (confirmedEditSequence !== undefined && (draft.editSequence ?? 0) <= confirmedEditSequence) {
      continue
    }

    visibleDraftKeys.add(key)
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
      if (progressByQuestionStudent.has(key) || visibleDraftKeys.has(key)) {
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

  const progress = [...progressByQuestionStudent.values()].sort((left, right) => {
    if (left.status === 'submitted' && right.status === 'submitted') {
      return left.updatedAt - right.updatedAt
    }
    if (left.status === 'submitted') return -1
    if (right.status === 'submitted') return 1
    return left.updatedAt - right.updatedAt
  })
  const orderedResponses = [...responses].sort((left, right) => left.submittedAt - right.submittedAt)

  return {
    sessionId: session.id,
    presentationMode,
    stagedRun,
    questions,
    activeQuestionId,
    activeQuestionIds,
    activeQuestionRunStartedAt,
    activeQuestionRunRevision,
    activeQuestionDeadlineAt,
    lastActiveQuestionRunRevision:
      session.data.lastActiveQuestionRunRevision > 0 ? session.data.lastActiveQuestionRunRevision : null,
    students: Object.values(students),
    responses: orderedResponses.map((r) => ({
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

export function generateImportedQuestionId(
  existingQuestionIds: Set<string>,
  random: () => number = Math.random,
  now: () => number = Date.now,
): string {
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const randomSuffix = random().toString(36).slice(2, 12)
    const suffix = randomSuffix.length > 0 ? randomSuffix : now().toString(36)
    const id = `q_imported_${suffix}`
    if (!existingQuestionIds.has(id)) {
      return id
    }
  }

  return `q_imported_${now().toString(36)}_${existingQuestionIds.size}`
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

function resolveStudentPrincipal(
  session: ResonanceSession,
  sessionId: string,
  cookies: Record<string, unknown> | undefined,
): string | null {
  const principal = resolveActivityPrincipalFromCookies(session, sessionId, 'participant', cookies)
  return principal?.subjectId && session.data.students[principal.subjectId]
    ? principal.subjectId
    : null
}

function resolveWebSocketStudentPrincipal(
  session: ResonanceSession,
  sessionId: string,
  cookieHeader: unknown,
): { studentId: string; capabilityId: string } | null {
  const cookieName = getActivityCapabilityCookieName('participant', sessionId)
  const principal = resolveActivityPrincipalFromCookies(session, sessionId, 'participant', {
    [cookieName]: readCookieValue(cookieHeader, cookieName),
  })
  return principal?.subjectId && session.data.students[principal.subjectId]
    ? { studentId: principal.subjectId, capabilityId: principal.capabilityId }
    : null
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

registerActivityReportBuilder('resonance', (session, params) => {
  const normalizedSession = asResonanceSession(session)
  if (!normalizedSession) {
    return null
  }

  return buildResonanceStructuredReportSection(
    buildResonanceReport({
      id: normalizedSession.id,
      ...normalizedSession.data,
    }),
    { instanceKey: params.instanceKey },
  )
})

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export default function setupResonanceRoutes(
  app: ResonanceRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
  deadlineTaskRunner: DeadlineTaskRunner = defaultDeadlineTaskRunner,
): void {
  const deadlineTasks = new Map<string, {
    deadlineAt: number
    runStartedAt: number | null
    handle: DeadlineTaskHandle
  }>()

  function armDeadlineTask(
    sessionId: string,
    deadlineAt: number,
    runStartedAt: number | null,
    delayMs: number,
  ): void {
    const handle = deadlineTaskRunner.schedule(() => {
      const current = deadlineTasks.get(sessionId)
      if (!current || current.handle !== handle) return

      const remaining = deadlineAt - deadlineTaskRunner.now()
      if (remaining > 0) {
        deadlineTasks.delete(sessionId)
        armDeadlineTask(sessionId, deadlineAt, runStartedAt, remaining)
        return
      }

      void loadResonanceSession(sessionId, true).then((loaded) => {
        if (loaded !== null) return
        const latest = deadlineTasks.get(sessionId)
        if (latest?.handle === handle) deadlineTasks.delete(sessionId)
      }).catch((error) => {
        console.error(JSON.stringify({
          component: 'resonance',
          event: 'deadline-task-failed',
          sessionId,
          error: String(error),
        }))
        const latest = deadlineTasks.get(sessionId)
        if (latest?.handle !== handle) return
        deadlineTasks.delete(sessionId)
        armDeadlineTask(sessionId, deadlineAt, runStartedAt, DEADLINE_TASK_RETRY_MS)
      })
    }, Math.min(Math.max(0, delayMs), MAX_SET_TIMEOUT_MS))
    handle.unref?.()
    deadlineTasks.set(sessionId, { deadlineAt, runStartedAt, handle })
  }

  function reconcileDeadlineTask(session: ResonanceSession): void {
    const existing = deadlineTasks.get(session.id)
    const deadlineAt = session.data.activeQuestionDeadlineAt
    const runStartedAt = session.data.activeQuestionRunStartedAt
    if (deadlineAt === null || deadlineAt <= deadlineTaskRunner.now()) {
      if (existing) {
        deadlineTaskRunner.cancel(existing.handle)
        deadlineTasks.delete(session.id)
      }
      return
    }
    if (existing?.deadlineAt === deadlineAt && existing.runStartedAt === runStartedAt) {
      return
    }
    if (existing) {
      deadlineTaskRunner.cancel(existing.handle)
    }

    armDeadlineTask(session.id, deadlineAt, runStartedAt, deadlineAt - deadlineTaskRunner.now())
  }

  async function loadResonanceSession(sessionId: string, strict = false): Promise<ResonanceSession | null> {
    const readSession = strict && sessions.getStrict
      ? sessions.getStrict.bind(sessions)
      : sessions.get.bind(sessions)
    const loadedSession = asResonanceSession(await readSession(sessionId))
    if (!loadedSession) {
      return null
    }

    // SessionCache returns its live value by reference. Work on a detached
    // copy so a failed timeout-finalization write cannot make local reads look
    // expired and cancel the retry while durable storage still has the run.
    const session = structuredClone(loadedSession)

    const hadSelfPacedMode = session.data.selfPacedMode === true
    const resolvedSelfPacedMode =
      hadSelfPacedMode
        ? true
        : await resolveSelfPacedMode(session, sessions)
    const expiration = expireActiveQuestionRunIfNeeded(session, deadlineTaskRunner.now())
    if (expiration.changed) {
      await sessions.set(sessionId, session)
      await broadcastStudentSessionState(session, sessionId)
      broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
    } else if (!hadSelfPacedMode && resolvedSelfPacedMode && session.data.selfPacedMode === true) {
      await sessions.set(sessionId, session)
    }

    reconcileDeadlineTask(session)

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
    const presentationMode = normalizePresentationMode(body.presentationMode)

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
        presentationMode,
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
      presentationMode,
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

    const body = isPlainObject(req.body) ? req.body : {}
    const requestedId = typeof body.studentId === 'string' && /^[\w-]+$/.test(body.studentId)
      ? body.studentId
      : null
    const existingPrincipalId = resolveStudentPrincipal(session, sessionId, req.cookies)
    const acceptedParticipant = resolveAcceptedEntryParticipantToken(
      session,
      req.cookies?.[getSessionParticipantCookieName(sessionId)],
    )
    // A newly accepted waiting-room participant is fresher than a capability
    // cookie a shared browser may have retained from a previous student.
    const authorizedId = acceptedParticipant?.participantId ?? existingPrincipalId ?? null
    if (requestedId !== null && requestedId !== authorizedId) {
      console.warn(JSON.stringify({
        component: 'resonance',
        event: 'student-registration-denied',
        sessionId,
        reason: 'student-id-mismatch',
      }))
      res.status(403).json({ error: 'participant authentication required' })
      return
    }
    if (authorizedId === null) {
      try {
        const rateLimit = await recordRateLimitAttemptStrict(
          getRegistrationRateLimitKey(sessionId, req.ip),
          MAX_UNAUTHENTICATED_DIRECT_REGISTRATIONS_PER_MINUTE,
        )
        if (!rateLimit.allowed) {
          console.warn(JSON.stringify({
            component: 'resonance', event: 'student-registration-denied', sessionId,
            reason: 'direct-registration-rate-limited', attempts: rateLimit.attempts,
          }))
          res.setHeader?.('Retry-After', '60')
          res.status(429).json({ error: 'too many registration attempts; try again shortly' })
          return
        }
      } catch (error) {
        console.error(JSON.stringify({
          component: 'resonance', event: 'student-registration-rate-limit-failed', sessionId,
          error: error instanceof Error ? error.message : 'unknown error',
        }))
        res.status(503).json({ error: 'registration temporarily unavailable' })
        return
      }
    }
    const studentId = authorizedId ?? `s_${Math.random().toString(36).slice(2, 12)}`

    const student: Student = {
      studentId,
      name: validated.name,
      joinedAt: Date.now(),
    }

    // `loadResonanceSession` can return the cache's mutable record. Prepare
    // registration changes on a detached copy so a failed store write cannot
    // consume an accepted-entry handoff only in this process.
    const registrationSession = structuredClone(session)
    const reusesSelectedCapability = existingPrincipalId !== null && existingPrincipalId === authorizedId
    const capability = reusesSelectedCapability
      ? null
      : tryIssueActivityCapability(registrationSession, 'participant', studentId)
    if (!reusesSelectedCapability && capability === null) {
      console.warn(JSON.stringify({
        component: 'resonance',
        event: 'student-registration-denied',
        sessionId,
        reason: 'participant-capacity-reached',
      }))
      res.status(429).json({ error: 'session participant capacity reached' })
      return
    }
    registrationSession.data.students[studentId] = student
    // Accepted-entry handoffs are one-shot. Their consumption and capability
    // issuance persist in this one session write, so a failed write consumes
    // neither and a successful one cannot be replayed.
    if (acceptedParticipant !== null) {
      revokeAcceptedEntryParticipant(registrationSession, studentId)
    }
    try {
      await sessions.set(sessionId, registrationSession)
    } catch (error) {
      console.error(JSON.stringify({
        component: 'resonance',
        event: 'student-registration-persist-failed',
        sessionId,
        error: error instanceof Error ? error.message : 'unknown error',
      }))
      res.status(503).json({ error: 'registration temporarily unavailable' })
      return
    }

    if (capability && res.cookie) {
      writeActivityCapabilityCookie({ cookie: res.cookie.bind(res) }, sessionId, 'participant', capability.token)
    }
    res.setHeader?.('Cache-Control', 'no-store')
    console.info(JSON.stringify({
      component: 'resonance',
      event: 'student-registered',
      sessionId,
      studentId,
    }))
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
    const studentId = resolveStudentPrincipal(session, sessionId, req.cookies)
    if (!studentId) {
      console.warn(JSON.stringify({
        component: 'resonance',
        event: 'student-answer-submit-denied',
        sessionId,
        reason: 'missing-participant-capability',
      }))
      res.status(403).json({ error: 'participant authentication required' })
      return
    }
    if (typeof body.studentId === 'string' && body.studentId !== studentId) {
      console.warn(JSON.stringify({
        component: 'resonance',
        event: 'student-answer-submit-denied',
        sessionId,
        reason: 'student-id-mismatch',
      }))
      res.status(403).json({ error: 'studentId does not match authenticated participant' })
      return
    }
    if (!matchesActiveQuestionRun(session.data, body.activeQuestionRunRevision, body.activeQuestionRunStartedAt)) {
      res.status(409).json({ error: 'question run changed' })
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

    const answerability = getQuestionAnswerability(session.data, questionId)
    if (!answerability.ok) {
      res.status(409).json({
        error: resolveAnswerabilityErrorMessage(answerability.reason),
      })
      return
    }

    const answer = validateAnswerPayload(body.answer, activeQuestion)
    if (!answer) {
      res.status(400).json({ error: 'invalid answer payload' })
      return
    }

    upsertResponse(
      session.data.responses,
      questionId,
      studentId,
      answer,
      session.data.activeQuestionRunRevision,
      resolveEditSequence(body.editSequence),
    )
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
    const authenticatedStudentId = resolveStudentPrincipal(session, sessionId, req.cookies)
    if (requestedStudentId !== null && requestedStudentId !== authenticatedStudentId) {
      console.warn(JSON.stringify({
        component: 'resonance',
        event: 'student-state-denied',
        sessionId,
        reason: authenticatedStudentId === null
          ? 'missing-participant-capability'
          : 'student-id-mismatch',
      }))
      res.status(403).json({ error: 'participant authentication required' })
      return
    }
    const selfPacedMode = await resolveSelfPacedMode(session, sessions)
    res.setHeader?.('Cache-Control', 'no-store')
    res.json(buildStudentSnapshotWithMode(session, authenticatedStudentId, selfPacedMode))
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
      const presentationMode = normalizePresentationMode(body.presentationMode ?? session.data.presentationMode)
      const runStartedAt = Date.now()
      session.data.presentationMode = presentationMode
      if (presentationMode === 'staged') {
        startStagedRun(session.data, orderedQuestionIds, runStartedAt)
      } else {
        const run = buildActiveQuestionRun(session.data.questions, orderedQuestionIds, runStartedAt)
        setActiveQuestions(
          session.data,
          run.questionIds,
          runStartedAt,
          nextActiveQuestionRunRevision(session.data),
          run.deadlineAt,
        )
      }
    } else {
      clearActiveQuestions(session.data)
    }

    if (requestedQuestionIds !== null && session.data.activeQuestionIds.length === 0) {
      res.status(404).json({ error: 'question not found' })
      return
    }
    await sessions.set(sessionId, session)
    reconcileDeadlineTask(session)

    console.info('[resonance] Question activation updated', {
      sessionId,
      activeQuestionIds: session.data.activeQuestionIds,
      activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
    })
    broadcastToRole('resonance:question-activated', buildActivationPayload(session.data), sessionId, true)
    void broadcastStudentSessionState(session, sessionId)
    broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
    res.json({
      ok: true,
      activeQuestionId: session.data.activeQuestionId,
      activeQuestionIds: session.data.activeQuestionIds,
      activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
      presentationMode: session.data.presentationMode,
      stagedRun: session.data.stagedRun,
    })
  })

  // POST /api/resonance/:sessionId/reveal-choices
  // Reveals choices for the current staged multiple-choice question and starts its timer.
  app.post('/api/resonance/:sessionId/reveal-choices', async (req, res) => {
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

    const stagedRun = session.data.stagedRun
    if (session.data.presentationMode !== 'staged' || stagedRun === null || stagedRun.currentQuestionId === null) {
      res.status(409).json({ error: 'no staged question is active' })
      return
    }

    const question = getQuestionById(session.data.questions, stagedRun.currentQuestionId)
    if (!question || question.type !== 'multiple-choice') {
      res.status(409).json({ error: 'current staged question has no choices to reveal' })
      return
    }
    if (stagedRun.choicesRevealed) {
      res.json({
        ok: true,
        activeQuestionId: session.data.activeQuestionId,
        activeQuestionIds: session.data.activeQuestionIds,
        activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
        presentationMode: session.data.presentationMode,
        stagedRun: session.data.stagedRun,
      })
      return
    }

    const now = Date.now()
    const nextRun = { ...stagedRun, choicesRevealed: true }
    setStagedActiveQuestion(
      session.data,
      nextRun,
      session.data.activeQuestionRunStartedAt ?? now,
      session.data.activeQuestionRunRevision,
      buildSingleQuestionDeadline(question, now),
    )
    await sessions.set(sessionId, session)
    reconcileDeadlineTask(session)

    console.info('[resonance] Staged choices revealed', {
      sessionId,
      questionId: question.id,
      activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
    })
    broadcastToRole('resonance:question-activated', buildActivationPayload(session.data), sessionId, true)
    void broadcastStudentSessionState(session, sessionId)
    broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)

    res.json({
      ok: true,
      activeQuestionId: session.data.activeQuestionId,
      activeQuestionIds: session.data.activeQuestionIds,
      activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
      presentationMode: session.data.presentationMode,
      stagedRun: session.data.stagedRun,
    })
  })

  // POST /api/resonance/:sessionId/advance-staged-question
  // Advances a staged run to the next question, skips a stem-only MCQ when requested,
  // or ends the run after the last question.
  app.post('/api/resonance/:sessionId/advance-staged-question', async (req, res) => {
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

    const stagedRun = session.data.stagedRun
    if (session.data.presentationMode !== 'staged' || stagedRun === null || stagedRun.currentQuestionId === null) {
      res.status(409).json({ error: 'no staged question is active' })
      return
    }

    const completedQuestionIds = Array.from(new Set([
      ...stagedRun.completedQuestionIds,
      stagedRun.currentQuestionId,
    ]))
    const nextIndex = stagedRun.currentIndex + 1
    const nextQuestionId = stagedRun.questionIds[nextIndex] ?? null

    if (nextQuestionId === null) {
      clearStagedRun(session.data)
      await sessions.set(sessionId, session)
      reconcileDeadlineTask(session)
      console.info('[resonance] Staged run completed', { sessionId })
      broadcastToRole('resonance:question-activated', buildActivationPayload(session.data), sessionId, true)
      void broadcastStudentSessionState(session, sessionId)
      broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
      res.json({
        ok: true,
        activeQuestionId: session.data.activeQuestionId,
        activeQuestionIds: session.data.activeQuestionIds,
        activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
        presentationMode: session.data.presentationMode,
        stagedRun: session.data.stagedRun,
      })
      return
    }

    const nextQuestion = getQuestionById(session.data.questions, nextQuestionId)
    const choicesRevealed = nextQuestion?.type !== 'multiple-choice'
    const now = Date.now()
    const nextRun: StagedRunState = {
      questionIds: stagedRun.questionIds,
      currentQuestionId: nextQuestionId,
      currentIndex: nextIndex,
      choicesRevealed,
      completedQuestionIds,
    }
    setStagedActiveQuestion(
      session.data,
      nextRun,
      now,
      nextActiveQuestionRunRevision(session.data),
      choicesRevealed ? buildSingleQuestionDeadline(nextQuestion, now) : null,
    )
    await sessions.set(sessionId, session)
    reconcileDeadlineTask(session)

    console.info('[resonance] Staged question advanced', {
      sessionId,
      questionId: nextQuestionId,
      currentIndex: nextIndex,
    })
    broadcastToRole('resonance:question-activated', buildActivationPayload(session.data), sessionId, true)
    void broadcastStudentSessionState(session, sessionId)
    broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)

    res.json({
      ok: true,
      activeQuestionId: session.data.activeQuestionId,
      activeQuestionIds: session.data.activeQuestionIds,
      activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
      presentationMode: session.data.presentationMode,
      stagedRun: session.data.stagedRun,
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

  // POST /api/resonance/:sessionId/import-questions
  // Appends a validated saved question set, remapping ids that already exist in the session.
  app.post('/api/resonance/:sessionId/import-questions', async (req, res) => {
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
    const { questions, errors } = validateQuestionSet(body.questions)
    if (errors.length > 0 || questions.length === 0) {
      res.status(400).json({ error: errors[0] ?? 'invalid question set', details: errors })
      return
    }

    const existingQuestionIds = new Set(session.data.questions.map((question) => question.id))
    let nextOrder = session.data.questions.length
    const remappedQuestionIds: Record<string, string> = {}
    const importedQuestions = questions.map((question) => {
      const id = existingQuestionIds.has(question.id)
        ? generateImportedQuestionId(existingQuestionIds)
        : question.id
      existingQuestionIds.add(id)
      if (id !== question.id) {
        remappedQuestionIds[question.id] = id
      }

      const importedQuestion = {
        ...question,
        id,
        order: nextOrder,
      }
      nextOrder += 1
      return importedQuestion
    })

    session.data.questions.push(...importedQuestions)
    await sessions.set(sessionId, session)

    console.info('[resonance] Question set imported', {
      sessionId,
      importedQuestionCount: importedQuestions.length,
      remappedQuestionCount: Object.keys(remappedQuestionIds).length,
      totalQuestionCount: session.data.questions.length,
    })
    void broadcastStudentSessionState(session, sessionId)
    broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
    res.json({ ok: true, questions: importedQuestions, remappedQuestionIds })
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
          const presentationMode = normalizePresentationMode(payload.presentationMode ?? session.data.presentationMode)
          const runStartedAt = Date.now()
          session.data.presentationMode = presentationMode
          if (presentationMode === 'staged') {
            startStagedRun(session.data, orderedQuestionIds, runStartedAt)
          } else {
            const run = buildActiveQuestionRun(session.data.questions, orderedQuestionIds, runStartedAt)
            setActiveQuestions(
              session.data,
              run.questionIds,
              runStartedAt,
              nextActiveQuestionRunRevision(session.data),
              run.deadlineAt,
            )
          }
        }
        await sessions.set(sessionId, session)
        reconcileDeadlineTask(session)
        console.info('[resonance] WS activate-question', {
          sessionId,
          activeQuestionIds: session.data.activeQuestionIds,
          activeQuestionDeadlineAt: session.data.activeQuestionDeadlineAt,
        })
        broadcastToRole('resonance:question-activated', buildActivationPayload(session.data), sessionId, true)
        void broadcastStudentSessionState(session, sessionId)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:reveal-choices': {
        const stagedRun = session.data.stagedRun
        if (session.data.presentationMode !== 'staged' || stagedRun === null || stagedRun.currentQuestionId === null) return
        if (stagedRun.choicesRevealed) return
        const question = getQuestionById(session.data.questions, stagedRun.currentQuestionId)
        if (!question || question.type !== 'multiple-choice') return
        const now = Date.now()
        setStagedActiveQuestion(
          session.data,
          { ...stagedRun, choicesRevealed: true },
          session.data.activeQuestionRunStartedAt ?? now,
          session.data.activeQuestionRunRevision,
          buildSingleQuestionDeadline(question, now),
        )
        await sessions.set(sessionId, session)
        reconcileDeadlineTask(session)
        console.info('[resonance] WS reveal choices', { sessionId, questionId: question.id })
        broadcastToRole('resonance:question-activated', buildActivationPayload(session.data), sessionId, true)
        void broadcastStudentSessionState(session, sessionId)
        broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(session), sessionId, true)
        break
      }

      case 'resonance:advance-staged-question': {
        // Advancing from a stem-only MCQ is an intentional instructor skip.
        const stagedRun = session.data.stagedRun
        if (session.data.presentationMode !== 'staged' || stagedRun === null || stagedRun.currentQuestionId === null) return
        const nextIndex = stagedRun.currentIndex + 1
        const nextQuestionId = stagedRun.questionIds[nextIndex] ?? null
        const completedQuestionIds = Array.from(new Set([...stagedRun.completedQuestionIds, stagedRun.currentQuestionId]))
        if (nextQuestionId === null) {
          clearStagedRun(session.data)
        } else {
          const nextQuestion = getQuestionById(session.data.questions, nextQuestionId)
          const choicesRevealed = nextQuestion?.type !== 'multiple-choice'
          const now = Date.now()
          setStagedActiveQuestion(
            session.data,
            {
              questionIds: stagedRun.questionIds,
              currentQuestionId: nextQuestionId,
              currentIndex: nextIndex,
              choicesRevealed,
              completedQuestionIds,
            },
            now,
            nextActiveQuestionRunRevision(session.data),
            choicesRevealed ? buildSingleQuestionDeadline(nextQuestion, now) : null,
          )
        }
        await sessions.set(sessionId, session)
        reconcileDeadlineTask(session)
        console.info('[resonance] WS advance staged question', {
          sessionId,
          activeQuestionId: session.data.activeQuestionId,
        })
        broadcastToRole('resonance:question-activated', buildActivationPayload(session.data), sessionId, true)
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
    socket: ResonanceSocket,
  ): Promise<void> {
    switch (type) {
      case 'resonance:submit-answer': {
        const studentId = resolveSocketStudentId(payload.studentId, clientStudentId)
        if (!studentId || !session.data.students[studentId]) return
        if (!matchesActiveQuestionRun(
          session.data,
          payload.activeQuestionRunRevision,
          payload.activeQuestionRunStartedAt,
        )) return
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
        const answerability = getQuestionAnswerability(session.data, questionId)
        if (!answerability.ok) return
        const answer = validateAnswerPayload(payload.answer, activeQuestion)
        if (!answer) return
        const response = upsertResponse(
          session.data.responses,
          questionId,
          studentId,
          answer,
          session.data.activeQuestionRunRevision,
          resolveEditSequence(payload.editSequence),
        )
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
        const studentId = resolveSocketStudentId(payload.studentId, clientStudentId)
        if (!studentId || !session.data.students[studentId]) return
        if (!matchesActiveQuestionRun(
          session.data,
          payload.activeQuestionRunRevision,
          payload.activeQuestionRunStartedAt,
        )) return
        const selfPacedMode = await resolveSelfPacedMode(session, sessions)
        // This runs after the final await in this handler. A deadline can pass
        // while resolving an embedded session mode, so validate and timestamp
        // the write atomically from the handler's point of view.
        const draftUpdatedAt = Date.now()
        if (
          session.data.activeQuestionDeadlineAt !== null &&
          draftUpdatedAt >= session.data.activeQuestionDeadlineAt
        ) return
        const availableQuestionIds = resolveStudentAvailableQuestionIds(session, selfPacedMode)

        const questionId = typeof payload.questionId === 'string'
          ? payload.questionId
          : availableQuestionIds.length === 1
            ? (availableQuestionIds[0] ?? null)
            : session.data.activeQuestionId
        if (!questionId || !availableQuestionIds.includes(questionId)) return

        const question = session.data.questions.find((entry) => entry.id === questionId) ?? null
        if (!question) return
        if (!isCurrentStagedQuestionAnswerable(session.data, questionId)) return

        const draftId = typeof payload.draftId === 'string' && payload.draftId.length <= 128
          ? payload.draftId
          : null
        const editSequence = resolveEditSequence(payload.editSequence)
        const draftGeneration = resolveDraftGeneration(payload.draftGeneration)

        // A draft sent just before a submission can arrive here after the
        // submission already recorded a response and cleared the draft (the
        // two travel over different connections/transports, so delivery
        // order isn't guaranteed). The revisit flow deliberately allows a
        // student to reopen an already-submitted question in the same run, so
        // response existence alone can't distinguish a stale pre-submission
        // draft from a legitimate post-submission revision — only a draft
        // whose editSequence hasn't advanced past the confirmed response's is
        // stale. Otherwise timeout finalization could either overwrite the
        // confirmed answer with a stale draft, or silently drop a genuine
        // revision the student made after resubmitting was already locked.
        const confirmedResponseForRun = session.data.responses.find(
          (response) =>
            response.questionId === questionId &&
            response.studentId === studentId &&
            response.activeQuestionRunRevision === session.data.activeQuestionRunRevision,
        )
        if (confirmedResponseForRun !== undefined && editSequence <= (confirmedResponseForRun.editSequence ?? 0)) {
          if (draftId !== null) {
            sendToSocket(socket, 'resonance:draft-saved', { draftId }, sessionId)
          }
          return
        }

        const draftKey = buildDraftKey(questionId, studentId)
        const answer = payload.answer === null ? null : validateAnswerPayload(payload.answer, question)
        if (payload.answer !== null && !answer) return
        // Draft ordering is a cross-connection guarantee. A read/modify/write
        // fallback could commit an older handler after a newer one, so fail
        // safely on stores that cannot provide the required CAS primitive.
        if (typeof sessions.updateAtomic !== 'function') {
          console.error(JSON.stringify({ event: 'resonance.draft-save-unavailable', sessionId, studentId, questionId }))
          return
        }

        let persistedSession: ResonanceSession | null = null
        const updated = await sessions.updateAtomic(sessionId, (current) => {
          const currentSession = current as ResonanceSession
          currentSession.data = normalizeSessionData(currentSession.data)
          if (!matchesActiveQuestionRun(
            currentSession.data,
            payload.activeQuestionRunRevision,
            payload.activeQuestionRunStartedAt,
          )) return currentSession

          const currentDraft = currentSession.data.responseDrafts[draftKey]
          const currentGeneration = currentSession.data.responseDraftGenerations[draftKey]
          const generationForCurrentRun = currentGeneration?.activeQuestionRunRevision === currentSession.data.activeQuestionRunRevision
            ? currentGeneration.draftGeneration
            : 0
          const storedGeneration = Math.max(
            currentDraft?.activeQuestionRunRevision === currentSession.data.activeQuestionRunRevision
              ? currentDraft.draftGeneration ?? 0
              : 0,
            generationForCurrentRun,
          )
          if (draftGeneration < storedGeneration) return currentSession

          currentSession.data.responseDraftGenerations[draftKey] = {
            questionId,
            studentId,
            activeQuestionRunRevision: currentSession.data.activeQuestionRunRevision,
            draftGeneration,
          }
          if (answer === null) {
            delete currentSession.data.responseDrafts[draftKey]
          } else {
            currentSession.data.responseDrafts[draftKey] = {
              questionId,
              studentId,
              updatedAt: draftUpdatedAt,
              activeQuestionRunRevision: currentSession.data.activeQuestionRunRevision,
              editSequence,
              ...(draftGeneration > 0 ? { draftGeneration } : {}),
              answer,
            }
          }
          persistedSession = currentSession
          return currentSession
        })
        if (updated === null) {
          console.error(JSON.stringify({
            component: 'resonance',
            event: 'draft-save-atomic-update-failed',
            sessionId,
            studentId,
            questionId,
          }))
          return
        }
        if (persistedSession !== null) persistedSession = updated as ResonanceSession
        if (persistedSession !== null) {
          broadcastToRole('resonance:instructor-state', buildInstructorSnapshot(persistedSession), sessionId, true)
        }
        if (draftId !== null) {
          sendToSocket(socket, 'resonance:draft-saved', { draftId }, sessionId)
        }
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
    const sessionId = queryParams.get('sessionId') ?? null
    client.sessionId = null
    client.isInstructor = false
    client.studentId = null

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
        client.sessionId = sessionId
        client.isInstructor = true
        sendToSocket(client, 'resonance:instructor-state', buildInstructorSnapshot(session), sessionId)
      } else {
        const authenticatedPrincipal = resolveWebSocketStudentPrincipal(
          session,
          sessionId,
          client.upgradeHeaders?.cookie,
        )
        const requestedStudentId = queryParams.get('studentId')
        if (
          authenticatedPrincipal === null ||
          (requestedStudentId !== null && requestedStudentId !== authenticatedPrincipal.studentId)
        ) {
          console.warn(JSON.stringify({
            component: 'resonance',
            event: 'student-websocket-denied',
            sessionId,
            reason: 'missing-or-mismatched-participant-capability',
          }))
          socket.close(1008, 'participant authentication required')
          return
        }
        client.sessionId = sessionId
        client.studentId = authenticatedPrincipal.studentId
        scheduleParticipantCapabilityExpiryClose(client, session, authenticatedPrincipal.capabilityId)
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
              await handleStudentWsMessage(sess, msgType, msgPayload, sessionId, client.studentId, client)
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

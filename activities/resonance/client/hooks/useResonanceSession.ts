import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isValidStudentReactionEmoji } from '../../shared/emojiSet.js'
import { getMcqSelectionMode } from '../../shared/mcq.js'
import type {
  AnswerPayload,
  QuestionReveal,
  ResonancePresentationMode,
  ReviewedResponse,
  SharedResponse,
  StagedRunState,
  StudentMCQOption,
  StudentQuestion,
  StudentSessionSnapshot,
  ViewerRevealResponse,
} from '../../shared/types.js'

const FALLBACK_POLL_INTERVAL_MS = 15_000
const DRAFT_SAVE_ACK_TIMEOUT_MS = 2_000

function getDraftRetryKey(payload: Record<string, unknown>): string | null {
  const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
  const runToken = typeof payload.activeQuestionRunRevision === 'number'
    ? payload.activeQuestionRunRevision
    : typeof payload.activeQuestionRunStartedAt === 'number'
      ? payload.activeQuestionRunStartedAt
      : null
  return questionId === null ? null : `${questionId}:${runToken ?? 'self-paced'}`
}

function getDraftGeneration(payload: Record<string, unknown>): number {
  return typeof payload.draftGeneration === 'number' && Number.isSafeInteger(payload.draftGeneration) && payload.draftGeneration >= 0
    ? payload.draftGeneration
    : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStudentMcqOption(value: unknown): StudentMCQOption | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return null
  }

  if (typeof value.text !== 'string') {
    return null
  }

  return {
    id: value.id,
    text: value.text,
  }
}

function normalizeStudentQuestion(value: unknown): StudentQuestion | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return null
  }

  if (value.type !== 'free-response' && value.type !== 'multiple-choice') {
    return null
  }

  if (typeof value.text !== 'string') {
    return null
  }

  const order = typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : 0
  const responseTimeLimitMs =
    value.responseTimeLimitMs === null
      ? null
      : typeof value.responseTimeLimitMs === 'number' && Number.isFinite(value.responseTimeLimitMs)
        ? value.responseTimeLimitMs
        : undefined

  if (value.type === 'free-response') {
    return {
      id: value.id,
      type: 'free-response',
      text: value.text,
      order,
      ...(responseTimeLimitMs !== undefined ? { responseTimeLimitMs } : {}),
    }
  }

  if (!Array.isArray(value.options)) {
    return null
  }

  const options = value.options
    .map(normalizeStudentMcqOption)
    .filter((option): option is StudentMCQOption => option !== null)

  if (options.length !== value.options.length) {
    return null
  }

  return {
    id: value.id,
    type: 'multiple-choice',
    text: value.text,
    order,
    options,
    selectionMode: value.selectionMode === 'multiple' ? 'multiple' : getMcqSelectionMode({ options }),
    ...(typeof value.choicesRevealed === 'boolean' ? { choicesRevealed: value.choicesRevealed } : {}),
    ...(responseTimeLimitMs !== undefined ? { responseTimeLimitMs } : {}),
  }
}

function normalizePresentationMode(value: unknown): ResonancePresentationMode {
  return value === 'staged' ? 'staged' : 'standard'
}

function normalizeStagedRunState(value: unknown): StagedRunState | null {
  if (!isRecord(value)) {
    return null
  }

  const questionIds = Array.isArray(value.questionIds)
    ? value.questionIds.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  const currentQuestionId = typeof value.currentQuestionId === 'string' && value.currentQuestionId.trim().length > 0
    ? value.currentQuestionId
    : null
  const currentIndex = typeof value.currentIndex === 'number' && Number.isFinite(value.currentIndex)
    ? Math.max(0, Math.round(value.currentIndex))
    : 0
  const completedQuestionIds = Array.isArray(value.completedQuestionIds)
    ? value.completedQuestionIds.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []

  return {
    questionIds,
    currentQuestionId,
    currentIndex,
    choicesRevealed: value.choicesRevealed === true,
    completedQuestionIds,
  }
}

function normalizeAnswerPayload(value: unknown): AnswerPayload | null {
  if (!isRecord(value)) {
    return null
  }

  if (value.type === 'free-response') {
    if (typeof value.text !== 'string') {
      return null
    }

    return {
      type: 'free-response',
      text: value.text,
    }
  }

  if (value.type === 'multiple-choice') {
    const rawSelectedOptionIds = Array.isArray(value.selectedOptionIds)
      ? value.selectedOptionIds
      : typeof value.selectedOptionId === 'string'
        ? [value.selectedOptionId]
        : null

    if (
      !rawSelectedOptionIds ||
      rawSelectedOptionIds.length === 0
    ) {
      return null
    }

    const selectedOptionIds: string[] = []
    const seenOptionIds = new Set<string>()

    for (const entry of rawSelectedOptionIds) {
      if (typeof entry !== 'string') {
        return null
      }

      const normalizedEntry = entry.trim()
      if (normalizedEntry.length === 0) {
        return null
      }

      if (!seenOptionIds.has(normalizedEntry)) {
        seenOptionIds.add(normalizedEntry)
        selectedOptionIds.push(normalizedEntry)
      }
    }

    if (selectedOptionIds.length === 0) {
      return null
    }

    return {
      type: 'multiple-choice',
      selectedOptionIds,
    }
  }

  return null
}

function normalizeSharedResponseReactions(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
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

function normalizeSharedResponse(value: unknown): SharedResponse | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return null
  }

  if (typeof value.questionId !== 'string' || value.questionId.trim().length === 0) {
    return null
  }

  if (typeof value.sharedAt !== 'number' || !Number.isFinite(value.sharedAt)) {
    return null
  }

  const answer = normalizeAnswerPayload(value.answer)
  if (!answer) {
    return null
  }

  return {
    id: value.id,
    questionId: value.questionId,
    answer,
    sharedAt: value.sharedAt,
    instructorEmoji: typeof value.instructorEmoji === 'string' ? value.instructorEmoji : null,
    reactions: normalizeSharedResponseReactions(value.reactions),
    ...(typeof value.isOwnResponse === 'boolean' ? { isOwnResponse: value.isOwnResponse } : {}),
    ...(typeof value.viewerReaction === 'string' || value.viewerReaction === null
      ? { viewerReaction: value.viewerReaction }
      : {}),
  }
}

function normalizeQuestionReveal(value: unknown): QuestionReveal | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.questionId !== 'string' || value.questionId.trim().length === 0) {
    return null
  }

  if (typeof value.sharedAt !== 'number' || !Number.isFinite(value.sharedAt)) {
    return null
  }

  if (value.correctOptionIds !== null && (!Array.isArray(value.correctOptionIds) || value.correctOptionIds.some((entry) => typeof entry !== 'string'))) {
    return null
  }

  if (!Array.isArray(value.sharedResponses)) {
    return null
  }

  const sharedResponses = value.sharedResponses
    .map(normalizeSharedResponse)
    .filter((response): response is SharedResponse => response !== null)

  if (sharedResponses.length !== value.sharedResponses.length) {
    return null
  }

  let viewerResponse: ViewerRevealResponse | null | undefined
  if (value.viewerResponse === null) {
    viewerResponse = null
  } else if (value.viewerResponse !== undefined) {
    if (!isRecord(value.viewerResponse)) {
      return null
    }

    const answer = normalizeAnswerPayload(value.viewerResponse.answer)
    if (!answer) {
      return null
    }

    if (
      typeof value.viewerResponse.submittedAt !== 'number' ||
      !Number.isFinite(value.viewerResponse.submittedAt)
    ) {
      return null
    }

    if (
      value.viewerResponse.instructorEmoji !== null &&
      typeof value.viewerResponse.instructorEmoji !== 'string'
    ) {
      return null
    }

    if (typeof value.viewerResponse.isShared !== 'boolean') {
      return null
    }

    viewerResponse = {
      answer,
      submittedAt: value.viewerResponse.submittedAt,
      instructorEmoji: value.viewerResponse.instructorEmoji,
      isShared: value.viewerResponse.isShared,
    }
  }

  return {
    questionId: value.questionId,
    sharedAt: value.sharedAt,
    correctOptionIds: value.correctOptionIds as string[] | null,
    sharedResponses,
    ...(viewerResponse !== undefined ? { viewerResponse } : {}),
  }
}

function normalizeReviewedResponse(value: unknown): ReviewedResponse | null {
  if (!isRecord(value)) {
    return null
  }

  const question = normalizeStudentQuestion(value.question)
  const answer = normalizeAnswerPayload(value.answer)
  if (!question || !answer) {
    return null
  }

  if (typeof value.submittedAt !== 'number' || !Number.isFinite(value.submittedAt)) {
    return null
  }

  if (typeof value.instructorEmoji !== 'string') {
    return null
  }

  return {
    question,
    answer,
    submittedAt: value.submittedAt,
    instructorEmoji: value.instructorEmoji,
  }
}

export function normalizeStudentSessionSnapshot(
  data: Partial<StudentSessionSnapshot> | null | undefined,
): StudentSessionSnapshot | null {
  if (!isRecord(data)) {
    return null
  }

  const activeQuestions = Array.isArray(data.activeQuestions)
    ? data.activeQuestions
      .map(normalizeStudentQuestion)
      .filter((question): question is StudentQuestion => question !== null)
    : []
  const fallbackActiveQuestion = normalizeStudentQuestion(data.activeQuestion)
  const normalizedActiveQuestions = activeQuestions.length > 0
    ? activeQuestions
    : fallbackActiveQuestion
      ? [fallbackActiveQuestion]
      : []
  const activeQuestionIds = Array.isArray(data.activeQuestionIds)
    ? data.activeQuestionIds.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : normalizedActiveQuestions.map((question) => question.id)

  return {
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
    selfPacedMode: data.selfPacedMode === true,
    presentationMode: normalizePresentationMode(data.presentationMode),
    stagedRun: normalizeStagedRunState(data.stagedRun),
    activeQuestion: normalizedActiveQuestions[0] ?? null,
    activeQuestions: normalizedActiveQuestions,
    activeQuestionIds,
    activeQuestionRunStartedAt:
      typeof data.activeQuestionRunStartedAt === 'number' && Number.isFinite(data.activeQuestionRunStartedAt)
        ? data.activeQuestionRunStartedAt
        : null,
    activeQuestionRunRevision:
      typeof data.activeQuestionRunRevision === 'number' && Number.isSafeInteger(data.activeQuestionRunRevision)
        ? data.activeQuestionRunRevision
        : null,
    activeQuestionDeadlineAt:
      typeof data.activeQuestionDeadlineAt === 'number' && Number.isFinite(data.activeQuestionDeadlineAt)
        ? data.activeQuestionDeadlineAt
        : null,
    lastActiveQuestionRunRevision:
      typeof data.lastActiveQuestionRunRevision === 'number' && Number.isSafeInteger(data.lastActiveQuestionRunRevision)
        ? data.lastActiveQuestionRunRevision
        : null,
    reveals: Array.isArray(data.reveals)
      ? data.reveals
        .map(normalizeQuestionReveal)
        .filter((reveal): reveal is QuestionReveal => reveal !== null)
      : [],
    reviewedResponses: Array.isArray(data.reviewedResponses)
      ? data.reviewedResponses
        .map(normalizeReviewedResponse)
        .filter((response): response is ReviewedResponse => response !== null)
      : [],
    submittedAnswers:
      isRecord(data.submittedAnswers)
        ? (data.submittedAnswers as StudentSessionSnapshot['submittedAnswers'])
        : {},
    submittedResponseEditSequences: isRecord(data.submittedResponseEditSequences)
      ? Object.fromEntries(
          Object.entries(data.submittedResponseEditSequences).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0,
          ),
        )
      : {},
    draftGenerations: isRecord(data.draftGenerations)
      ? Object.fromEntries(
          Object.entries(data.draftGenerations).filter(
            (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0,
          ),
        )
      : {},
    revealedQuestions: Array.isArray(data.revealedQuestions)
      ? data.revealedQuestions
        .map(normalizeStudentQuestion)
        .filter((question): question is StudentQuestion => question !== null)
      : [],
  }
}

/** Reject delayed session snapshots that would move a student back to an earlier live run. */
export function shouldApplyStudentSessionSnapshot(
  current: StudentSessionSnapshot | null,
  candidate: StudentSessionSnapshot,
  latestActiveQuestionRunRevision: number | null = current ? resolveObservedRunRevision(current) : null,
): boolean {
  if (current === null || current.sessionId !== candidate.sessionId) {
    return true
  }

  if (candidate.activeQuestionRunRevision === null) {
    if (latestActiveQuestionRunRevision !== null) {
      // A self-paced fallback or idle (no active questions) snapshot carries
      // no live run revision of its own, but the server also stamps the
      // highest live revision it has ever assigned. Accept the candidate only
      // when that stamp is at least as recent as the most recent live run
      // this client has observed, so a genuine live-to-self-paced/idle
      // transition is admitted while a stale legacy snapshot — or a delayed
      // idle snapshot generated before a newer run already started — is
      // still rejected instead of blanking the current live question.
      return (
        candidate.lastActiveQuestionRunRevision !== null &&
        candidate.lastActiveQuestionRunRevision >= latestActiveQuestionRunRevision
      )
    }
    if (current.activeQuestionIds.length === 0) return true
    const candidateStartedAt = candidate.activeQuestionRunStartedAt
    const currentStartedAt = current.activeQuestionRunStartedAt
    return candidateStartedAt === null || currentStartedAt === null || candidateStartedAt >= currentStartedAt
  }

  if (latestActiveQuestionRunRevision === null) return true

  if (current.activeQuestionRunRevision === null) {
    // `current` already reflects the end of the run at `latestActiveQuestionRunRevision`
    // (an idle/self-paced snapshot admitted above). A live candidate at or
    // below that watermark isn't a new activation — it's a delayed message
    // from the run that just ended — since a genuine next activation always
    // gets a strictly higher revision (see nextActiveQuestionRunRevision).
    return candidate.activeQuestionRunRevision > latestActiveQuestionRunRevision
  }

  return candidate.activeQuestionRunRevision >= latestActiveQuestionRunRevision
}

export function isLatestStudentSnapshotRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId
}

/**
 * The highest live-run revision a snapshot reflects, for advancing the
 * client's ordering watermark. `lastActiveQuestionRunRevision` is the
 * server's monotonic max and already subsumes `activeQuestionRunRevision`
 * (which resets to null on self-paced/idle); prefer it so an idle/self-paced
 * snapshot that's the first one a client observes still seeds the watermark,
 * rather than leaving it null and letting an out-of-order delivery of an
 * earlier live snapshot be wrongly accepted afterward.
 */
export function resolveObservedRunRevision(snapshot: StudentSessionSnapshot): number | null {
  return snapshot.lastActiveQuestionRunRevision ?? snapshot.activeQuestionRunRevision
}

export function selectStudentSessionSnapshot(
  current: StudentSessionSnapshot | null,
  candidate: StudentSessionSnapshot,
  latestActiveQuestionRunRevision?: number | null,
): { snapshot: StudentSessionSnapshot | null; accepted: boolean } {
  const accepted = shouldApplyStudentSessionSnapshot(current, candidate, latestActiveQuestionRunRevision)
  return {
    snapshot: accepted ? candidate : current,
    accepted,
  }
}

/**
 * Connects to the Resonance WebSocket as a student for real-time session state.
 * Falls back to REST polling while the WebSocket is reconnecting.
 *
 * @param sessionId  - The session to connect to, or null to defer.
 * @param studentId  - The registered student ID, forwarded to the WS for identity.
 */
export function useResonanceSession(sessionId: string | null, studentId?: string | null) {
  const [snapshot, setSnapshot] = useState<StudentSessionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  const latestSnapshotRequestRef = useRef(0)
  const snapshotRef = useRef<StudentSessionSnapshot | null>(null)
  const latestActiveQuestionRunRevisionRef = useRef<number | null>(null)
  const draftSaveSequenceRef = useRef(0)
  const pendingDraftSavesRef = useRef(new Map<string, {
    resolve(saved: boolean): void
    timeoutId: ReturnType<typeof setTimeout>
  }>())
  const queuedDraftRetriesRef = useRef(new Map<string, Record<string, unknown>>())
  const latestDraftGenerationByKeyRef = useRef(new Map<string, number>())
  const retryDraftSavesRef = useRef(new Map<string, {
    key: string
    generation: number
    timeoutId: ReturnType<typeof setTimeout>
  }>())

  useLayoutEffect(() => {
    latestSnapshotRequestRef.current += 1
    for (const pending of pendingDraftSavesRef.current.values()) {
      clearTimeout(pending.timeoutId)
      pending.resolve(false)
    }
    pendingDraftSavesRef.current.clear()
    for (const pending of retryDraftSavesRef.current.values()) {
      clearTimeout(pending.timeoutId)
    }
    retryDraftSavesRef.current.clear()
    queuedDraftRetriesRef.current.clear()
    latestDraftGenerationByKeyRef.current.clear()
    snapshotRef.current = null
    latestActiveQuestionRunRevisionRef.current = null
    setSnapshot(null)
    setLoading(sessionId !== null)
    setError(null)
  }, [sessionId, studentId])

  const flushQueuedDraftRetries = useCallback(() => {
    const currentWs = wsRef.current
    const currentSnapshot = snapshotRef.current
    if (currentWs?.readyState !== WebSocket.OPEN || currentSnapshot === null) return

    const activeRunToken = currentSnapshot.activeQuestionRunRevision ?? currentSnapshot.activeQuestionRunStartedAt
    for (const [key, payload] of queuedDraftRetriesRef.current) {
      const payloadRunToken = typeof payload.activeQuestionRunRevision === 'number'
        ? payload.activeQuestionRunRevision
        : typeof payload.activeQuestionRunStartedAt === 'number'
          ? payload.activeQuestionRunStartedAt
          : null
      const questionId = typeof payload.questionId === 'string' ? payload.questionId : null
      const isEligible =
        payload.studentId === studentId &&
        payloadRunToken === activeRunToken &&
        questionId !== null &&
        currentSnapshot.activeQuestionIds.includes(questionId) &&
        (currentSnapshot.activeQuestionDeadlineAt === null || Date.now() < currentSnapshot.activeQuestionDeadlineAt)
      if (!isEligible) {
        queuedDraftRetriesRef.current.delete(key)
        continue
      }
      if ([...retryDraftSavesRef.current.values()].some((pending) => pending.key === key)) continue

      const draftId = `draft-retry-${++draftSaveSequenceRef.current}`
      const timeoutId = setTimeout(() => {
        retryDraftSavesRef.current.delete(draftId)
      }, DRAFT_SAVE_ACK_TIMEOUT_MS)
      retryDraftSavesRef.current.set(draftId, { key, generation: getDraftGeneration(payload), timeoutId })
      try {
        currentWs.send(JSON.stringify({
          type: 'resonance:update-draft',
          payload: { ...payload, draftId },
        }))
      } catch {
        clearTimeout(timeoutId)
        retryDraftSavesRef.current.delete(draftId)
      }
    }
  }, [studentId])

  const queueDraftRetry = useCallback((key: string | null, payload: Record<string, unknown>) => {
    if (key === null) return
    const generation = getDraftGeneration(payload)
    const latest = latestDraftGenerationByKeyRef.current.get(key) ?? -1
    if (generation < latest) return
    latestDraftGenerationByKeyRef.current.set(key, generation)
    const queued = queuedDraftRetriesRef.current.get(key)
    if (!queued || getDraftGeneration(queued) <= generation) {
      queuedDraftRetriesRef.current.set(key, payload)
    }
  }, [])

  const fetchSnapshot = useCallback(async () => {
    if (sessionId === null) return
    const requestId = latestSnapshotRequestRef.current + 1
    latestSnapshotRequestRef.current = requestId
    try {
      const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : ''
      const resp = await fetch(`/api/resonance/${sessionId}/state${query}`)
      if (!mountedRef.current || !isLatestStudentSnapshotRequest(requestId, latestSnapshotRequestRef.current)) return
      if (!resp.ok) {
        setError('Could not load session state')
        setLoading(false)
        return
      }
      const data = normalizeStudentSessionSnapshot((await resp.json()) as Partial<StudentSessionSnapshot>)
      if (!mountedRef.current || !isLatestStudentSnapshotRequest(requestId, latestSnapshotRequestRef.current)) return
      if (data === null) {
        setError('Could not load session state')
        setLoading(false)
        return
      }
      const selection = selectStudentSessionSnapshot(
        snapshotRef.current,
        data,
        latestActiveQuestionRunRevisionRef.current,
      )
      snapshotRef.current = selection.snapshot
      if (selection.accepted) {
        const observedRevision = resolveObservedRunRevision(data)
        if (observedRevision !== null) {
          latestActiveQuestionRunRevisionRef.current = observedRevision
        }
      }
      setSnapshot(selection.snapshot)
      setError(null)
      setLoading(false)
    } catch {
      if (mountedRef.current && isLatestStudentSnapshotRequest(requestId, latestSnapshotRequestRef.current)) {
        setError('Network error — retrying…')
      }
    }
  }, [sessionId, studentId])

  useEffect(() => {
    if (sessionId === null) return
    mountedRef.current = true

    // Initial REST fetch for immediate state
    void fetchSnapshot()

    const params = new URLSearchParams({ sessionId, role: 'student' })
    if (studentId) params.set('studentId', studentId)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/resonance?${params.toString()}`

    let ws: WebSocket | null = null
    let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
    let fallbackIntervalId: ReturnType<typeof setInterval> | null = null
    let closed = false
    let reconnectDelay = 1_000

    function startFallback() {
      if (fallbackIntervalId !== null) return
      fallbackIntervalId = setInterval(() => void fetchSnapshot(), FALLBACK_POLL_INTERVAL_MS)
    }

    function stopFallback() {
      if (fallbackIntervalId !== null) {
        clearInterval(fallbackIntervalId)
        fallbackIntervalId = null
      }
    }

    function connect() {
      if (closed || !mountedRef.current) return
      const socket = new WebSocket(wsUrl)
      ws = socket
      wsRef.current = socket

      // Guard every handler by the specific socket it belongs to (not just the
      // shared `mountedRef`/`closed` flags): a session/student change resets
      // `mountedRef` to true for the *new* effect before an old socket's
      // already-in-flight message is dispatched, so a stale handler could
      // otherwise apply another participant's queued state to the new one.
      const isCurrent = () => !closed && wsRef.current === socket

      ws.onopen = () => {
        if (!isCurrent()) return
        reconnectDelay = 1_000
        stopFallback()
        flushQueuedDraftRetries()
      }

      ws.onmessage = (event) => {
        if (!isCurrent()) return
        try {
          const msg = JSON.parse(String(event.data)) as { type?: string; payload?: unknown }
          if (msg.type === 'resonance:session-state' && msg.payload !== undefined) {
            const normalized = normalizeStudentSessionSnapshot(msg.payload as Partial<StudentSessionSnapshot>)
            if (normalized) {
              const selection = selectStudentSessionSnapshot(
                snapshotRef.current,
                normalized,
                latestActiveQuestionRunRevisionRef.current,
              )
              if (selection.accepted) {
                latestSnapshotRequestRef.current += 1
                snapshotRef.current = selection.snapshot
                const observedRevision = resolveObservedRunRevision(normalized)
                if (observedRevision !== null) {
                  latestActiveQuestionRunRevisionRef.current = observedRevision
                }
                setSnapshot(selection.snapshot)
                setLoading(false)
                setError(null)
              }
            }
          } else if (msg.type === 'resonance:draft-saved' && isRecord(msg.payload)) {
            const draftId = typeof msg.payload.draftId === 'string' ? msg.payload.draftId : null
            const pending = draftId !== null ? pendingDraftSavesRef.current.get(draftId) : undefined
            if (pending && draftId !== null) {
              clearTimeout(pending.timeoutId)
              pendingDraftSavesRef.current.delete(draftId)
              pending.resolve(true)
            } else if (draftId !== null) {
              const retry = retryDraftSavesRef.current.get(draftId)
              if (retry) {
                clearTimeout(retry.timeoutId)
                retryDraftSavesRef.current.delete(draftId)
                const queued = queuedDraftRetriesRef.current.get(retry.key)
                if (queued && getDraftGeneration(queued) <= retry.generation) {
                  queuedDraftRetriesRef.current.delete(retry.key)
                }
              }
            }
          } else if (
            msg.type === 'resonance:results-shared' ||
            msg.type === 'resonance:sharing-stopped' ||
            msg.type === 'resonance:question-activated' ||
            msg.type === 'resonance:annotation-updated' ||
            msg.type === 'resonance:reaction-updated' ||
            msg.type === 'resonance:question-timer-updated'
          ) {
            // Event-only messages: re-fetch full student snapshot for simplicity
            void fetchSnapshot()
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        // handled by onclose
      }

      ws.onclose = () => {
        if (!isCurrent()) return
        wsRef.current = null
        ws = null
        for (const pending of retryDraftSavesRef.current.values()) {
          clearTimeout(pending.timeoutId)
        }
        retryDraftSavesRef.current.clear()
        if (!closed && mountedRef.current) {
          reconnectTimeoutId = setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
          // Poll while disconnected
          startFallback()
        }
      }
    }

    // Strict Mode discards its first effect setup. Deferring construction lets
    // that cleanup cancel before it opens a socket that immediately closes.
    queueMicrotask(() => {
      if (!closed) connect()
    })

    return () => {
      closed = true
      mountedRef.current = false
      stopFallback()
      if (reconnectTimeoutId !== null) clearTimeout(reconnectTimeoutId)
      if (ws !== null) ws.close()
      wsRef.current = null
    }
  }, [sessionId, studentId, fetchSnapshot, flushQueuedDraftRetries])

  useEffect(() => {
    flushQueuedDraftRetries()
  }, [flushQueuedDraftRetries, snapshot])

  /** Send a message to the server via the WebSocket. Returns true if sent. */
  const sendMessage = useCallback((type: string, payload: unknown): boolean => {
    const currentWs = wsRef.current
    if (currentWs?.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type, payload }))
      return true
    }
    return false
  }, [])

  /** Persist a draft and resolve only once the server acknowledges its write. */
  const saveDraft = useCallback((payload: Record<string, unknown>): Promise<boolean> => {
    const currentWs = wsRef.current
    const retryKey = getDraftRetryKey(payload)
    if (retryKey !== null) {
      latestDraftGenerationByKeyRef.current.set(
        retryKey,
        Math.max(latestDraftGenerationByKeyRef.current.get(retryKey) ?? -1, getDraftGeneration(payload)),
      )
    }
    if (currentWs?.readyState !== WebSocket.OPEN) {
      queueDraftRetry(retryKey, payload)
      return Promise.resolve(false)
    }

    const draftId = `draft-${++draftSaveSequenceRef.current}`
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingDraftSavesRef.current.delete(draftId)
        queueDraftRetry(retryKey, payload)
        resolve(false)
      }, DRAFT_SAVE_ACK_TIMEOUT_MS)
      pendingDraftSavesRef.current.set(draftId, { resolve, timeoutId })
      try {
        currentWs.send(JSON.stringify({
          type: 'resonance:update-draft',
          payload: { ...payload, draftId },
        }))
      } catch {
        // The socket can close between the readyState check above and this
        // send (e.g. a connection drop mid-call). An uncaught throw here
        // would reject this Promise, but callers only attach `.then` — the
        // draft would silently never be marked/reconciled as unconfirmed.
        clearTimeout(timeoutId)
        pendingDraftSavesRef.current.delete(draftId)
        queueDraftRetry(retryKey, payload)
        resolve(false)
      }
    })
  }, [queueDraftRetry])

  return { snapshot, loading, error, refresh: fetchSnapshot, sendMessage, saveDraft }
}

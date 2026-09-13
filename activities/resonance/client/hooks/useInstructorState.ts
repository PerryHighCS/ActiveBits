import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  InstructorAnnotation,
  InstructorSessionSnapshot,
  QuestionReveal,
  ResonancePresentationMode,
  ResponseProgress,
  ResponseWithName,
  StagedRunState,
  Student,
} from '../../shared/types.js'

const FALLBACK_POLL_INTERVAL_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isValidInstructorResponse(value: unknown): value is ResponseWithName {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string'
    && typeof value.questionId === 'string'
    && typeof value.studentId === 'string'
    && typeof value.studentName === 'string'
    && typeof value.submittedAt === 'number'
    && value.answer !== undefined
}

function isValidInstructorProgress(value: unknown): value is ResponseProgress {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.questionId === 'string'
    && typeof value.studentId === 'string'
    && typeof value.studentName === 'string'
    && typeof value.updatedAt === 'number'
    && (value.status === 'idle' || value.status === 'working' || value.status === 'submitted')
}

function isValidInstructorReveal(value: unknown): value is QuestionReveal {
  if (!isRecord(value)) {
    return false
  }

  if (typeof value.questionId !== 'string' || value.questionId.trim().length === 0) {
    return false
  }

  if (typeof value.sharedAt !== 'number' || !Number.isFinite(value.sharedAt)) {
    return false
  }

  if (value.correctOptionIds !== null && (!Array.isArray(value.correctOptionIds) || value.correctOptionIds.some((entry) => typeof entry !== 'string'))) {
    return false
  }

  return Array.isArray(value.sharedResponses)
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

/** Full instructor snapshot returned by GET /api/resonance/:sessionId/responses */
export interface InstructorStateSnapshot extends InstructorSessionSnapshot {
  responseOrderOverrides: Record<string, string[]>
}

export function normalizeInstructorStateSnapshot(
  data: Partial<InstructorStateSnapshot> | null | undefined,
): InstructorStateSnapshot | null {
  if (!isRecord(data)) {
    return null
  }

  const responses = Array.isArray(data.responses)
    ? data.responses.filter(isValidInstructorResponse)
    : []
  const submittedProgress = responses.map((response) => ({
    questionId: response.questionId,
    studentId: response.studentId,
    studentName: response.studentName,
    updatedAt: response.submittedAt,
    status: 'submitted' as const,
    answer: response.answer,
    responseId: response.id,
  }))

  const progressEntries = Array.isArray(data.progress)
    ? data.progress.filter(isValidInstructorProgress)
    : []
  const submittedKeys = new Set(
    submittedProgress.map((entry) => `${entry.questionId}:${entry.studentId}`),
  )
  const workingProgress = progressEntries.filter((entry) => {
    const key = `${entry.questionId}:${entry.studentId}`
    return entry.status !== 'submitted' && !submittedKeys.has(key)
  })
  const progress = [...submittedProgress, ...workingProgress]
  const fallbackActiveQuestionId = typeof data.activeQuestionId === 'string' ? data.activeQuestionId : null
  const activeQuestionIds = Array.isArray(data.activeQuestionIds)
    ? data.activeQuestionIds.filter((entry): entry is string => typeof entry === 'string')
    : fallbackActiveQuestionId
      ? [fallbackActiveQuestionId]
      : []

  return {
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
    presentationMode: normalizePresentationMode(data.presentationMode),
    stagedRun: normalizeStagedRunState(data.stagedRun),
    questions: Array.isArray(data.questions) ? data.questions : [],
    activeQuestionId: fallbackActiveQuestionId,
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
    students: Array.isArray(data.students) ? data.students : [],
    responses,
    progress,
    annotations: isRecord(data.annotations) ? data.annotations : {},
    reveals: Array.isArray(data.reveals)
      ? data.reveals.filter(isValidInstructorReveal)
      : [],
    responseOrderOverrides:
      isRecord(data.responseOrderOverrides)
        ? data.responseOrderOverrides
        : {},
  }
}

/**
 * The highest live-run revision a snapshot reflects, for advancing the
 * client's ordering watermark. Mirrors `resolveObservedRunRevision` for
 * students: `lastActiveQuestionRunRevision` is the server's monotonic max and
 * already subsumes `activeQuestionRunRevision` (which resets to null once a
 * run ends).
 */
export function resolveObservedInstructorRunRevision(snapshot: InstructorStateSnapshot): number | null {
  return snapshot.lastActiveQuestionRunRevision ?? snapshot.activeQuestionRunRevision
}

/**
 * Reject a delayed instructor snapshot that would restore an earlier run than
 * one already observed. A REST `/responses` request begun just before a
 * timeout finalizes can resolve after the WS `resonance:instructor-state`
 * broadcast for that finalization — without this check, `setSnapshot` would
 * apply that stale pre-expiry data unconditionally and, since REST polling is
 * stopped while the socket is open, the stale view could persist indefinitely.
 */
export function shouldApplyInstructorSnapshot(
  current: InstructorStateSnapshot | null,
  candidate: InstructorStateSnapshot,
  latestActiveQuestionRunRevision: number | null = current ? resolveObservedInstructorRunRevision(current) : null,
): boolean {
  if (current === null || current.sessionId !== candidate.sessionId) {
    return true
  }

  if (latestActiveQuestionRunRevision === null) return true

  if (candidate.activeQuestionRunRevision === null) {
    // An ended-run/idle candidate carries no live revision of its own, but
    // still stamps the highest live revision it has ever assigned. Accept it
    // only when that stamp is at least as recent as what's already observed.
    return (
      candidate.lastActiveQuestionRunRevision !== null &&
      candidate.lastActiveQuestionRunRevision >= latestActiveQuestionRunRevision
    )
  }

  if (current.activeQuestionRunRevision === null) {
    // `current` already reflects the end of the run at
    // `latestActiveQuestionRunRevision`. A live candidate at or below that
    // watermark isn't a new activation — it's a delayed message from the run
    // that just ended — since a genuine next activation always gets a
    // strictly higher revision (see nextActiveQuestionRunRevision).
    return candidate.activeQuestionRunRevision > latestActiveQuestionRunRevision
  }

  return candidate.activeQuestionRunRevision >= latestActiveQuestionRunRevision
}

export function isLatestInstructorSnapshotRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId
}

export function selectInstructorSnapshot(
  current: InstructorStateSnapshot | null,
  candidate: InstructorStateSnapshot,
  latestActiveQuestionRunRevision?: number | null,
): { snapshot: InstructorStateSnapshot | null; accepted: boolean } {
  const accepted = shouldApplyInstructorSnapshot(current, candidate, latestActiveQuestionRunRevision)
  return {
    snapshot: accepted ? candidate : current,
    accepted,
  }
}

/**
 * Connects to the Resonance WebSocket as an instructor for real-time session state.
 * Falls back to REST polling while the WebSocket is reconnecting.
 */
export function useInstructorState(sessionId: string | null, passcode: string | null) {
  const [snapshot, setSnapshot] = useState<InstructorStateSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  const latestSnapshotRequestRef = useRef(0)
  const snapshotRef = useRef<InstructorStateSnapshot | null>(null)
  const latestActiveQuestionRunRevisionRef = useRef<number | null>(null)

  // This hook instance can be retained while the manager switches sessions.
  // Reset before passive effects begin the next fetch/socket connection so a
  // previous session's run watermark cannot reject the next session's first
  // (lower-numbered) live run, and its snapshot is never painted while reloads.
  useLayoutEffect(() => {
    latestSnapshotRequestRef.current += 1
    snapshotRef.current = null
    latestActiveQuestionRunRevisionRef.current = null
    setSnapshot(null)
    setLoading(true)
    setError(null)
  }, [sessionId, passcode])

  const fetchSnapshot = useCallback(async () => {
    if (sessionId === null || passcode === null) return
    const requestId = latestSnapshotRequestRef.current + 1
    latestSnapshotRequestRef.current = requestId
    try {
      const resp = await fetch(`/api/resonance/${sessionId}/responses`, {
        headers: { 'X-Instructor-Passcode': passcode },
      })
      if (!mountedRef.current || !isLatestInstructorSnapshotRequest(requestId, latestSnapshotRequestRef.current)) return
      if (resp.status === 403) {
        setError('Invalid instructor passcode')
        setLoading(false)
        return
      }
      if (!resp.ok) {
        setError('Could not load session data')
        setLoading(false)
        return
      }
      const data = (await resp.json()) as {
        sessionId: string
        questions: InstructorStateSnapshot['questions']
        activeQuestionId: string | null
        activeQuestionIds: string[]
        activeQuestionRunStartedAt: number | null
        activeQuestionDeadlineAt: number | null
        students: Student[]
        responses: ResponseWithName[]
        progress: ResponseProgress[]
        annotations: Record<string, InstructorAnnotation>
        reveals: QuestionReveal[]
        responseOrderOverrides: Record<string, string[]>
      }
      if (!mountedRef.current || !isLatestInstructorSnapshotRequest(requestId, latestSnapshotRequestRef.current)) return
      const normalized = normalizeInstructorStateSnapshot(data)
      if (!normalized) {
        setError('Could not load session data')
        setLoading(false)
        return
      }
      const selection = selectInstructorSnapshot(
        snapshotRef.current,
        normalized,
        latestActiveQuestionRunRevisionRef.current,
      )
      snapshotRef.current = selection.snapshot
      if (selection.accepted) {
        const observedRevision = resolveObservedInstructorRunRevision(normalized)
        if (observedRevision !== null) {
          latestActiveQuestionRunRevisionRef.current = observedRevision
        }
      }
      setSnapshot(selection.snapshot)
      setError(null)
      setLoading(false)
    } catch {
      if (mountedRef.current && isLatestInstructorSnapshotRequest(requestId, latestSnapshotRequestRef.current)) {
        setError('Network error — retrying…')
      }
    }
  }, [sessionId, passcode])

  useEffect(() => {
    if (sessionId === null || passcode === null) return
    mountedRef.current = true

    // Initial REST fetch
    void fetchSnapshot()

    const params = new URLSearchParams({
      sessionId,
      role: 'instructor',
      instructorPasscode: passcode,
    })
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

      // Guard every handler by the specific socket it belongs to (not just
      // the shared `mountedRef`/`closed` flags): a session/passcode change
      // resets `mountedRef` to true for the *new* effect before an old
      // socket's already-in-flight message is dispatched, so a stale handler
      // could otherwise apply a prior session's instructor data to the new
      // one. Mirrors the student hook's `isCurrent` guard.
      const isCurrent = () => !closed && wsRef.current === socket

      ws.onopen = () => {
        if (!isCurrent()) return
        reconnectDelay = 1_000
        stopFallback()
      }

      ws.onmessage = (event) => {
        if (!isCurrent()) return
        try {
          const msg = JSON.parse(String(event.data)) as { type?: string; payload?: unknown }
          if (msg.type === 'resonance:instructor-state' && msg.payload !== undefined) {
            const normalized = normalizeInstructorStateSnapshot(msg.payload as Partial<InstructorStateSnapshot>)
            if (normalized) {
              const selection = selectInstructorSnapshot(
                snapshotRef.current,
                normalized,
                latestActiveQuestionRunRevisionRef.current,
              )
              if (selection.accepted) {
                // Invalidate any REST fetch already in flight — even one for
                // the same run revision — so it can't overwrite the response/
                // progress data this newer push just delivered.
                latestSnapshotRequestRef.current += 1
                snapshotRef.current = selection.snapshot
                const observedRevision = resolveObservedInstructorRunRevision(normalized)
                if (observedRevision !== null) {
                  latestActiveQuestionRunRevisionRef.current = observedRevision
                }
              }
              setSnapshot(selection.snapshot)
            }
            setLoading(false)
            setError(null)
          } else if (
            msg.type === 'resonance:annotation-updated' ||
            msg.type === 'resonance:response-received'
          ) {
            // Incremental events — refresh full state
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
        if (!closed && mountedRef.current) {
          reconnectTimeoutId = setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
          startFallback()
        }
      }
    }

    connect()

    return () => {
      closed = true
      mountedRef.current = false
      stopFallback()
      if (reconnectTimeoutId !== null) clearTimeout(reconnectTimeoutId)
      if (ws !== null) ws.close()
      wsRef.current = null
    }
  }, [sessionId, passcode, fetchSnapshot])

  return { snapshot, loading, error, refresh: fetchSnapshot }
}

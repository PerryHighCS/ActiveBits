import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudentMCQOption, StudentQuestion, StudentSessionSnapshot } from '../../shared/types.js'

const FALLBACK_POLL_INTERVAL_MS = 15_000

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
    ...(responseTimeLimitMs !== undefined ? { responseTimeLimitMs } : {}),
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
    activeQuestion: normalizedActiveQuestions[0] ?? null,
    activeQuestions: normalizedActiveQuestions,
    activeQuestionIds,
    activeQuestionRunStartedAt:
      typeof data.activeQuestionRunStartedAt === 'number' && Number.isFinite(data.activeQuestionRunStartedAt)
        ? data.activeQuestionRunStartedAt
        : null,
    activeQuestionDeadlineAt:
      typeof data.activeQuestionDeadlineAt === 'number' && Number.isFinite(data.activeQuestionDeadlineAt)
        ? data.activeQuestionDeadlineAt
        : null,
    reveals: Array.isArray(data.reveals) ? data.reveals : [],
    reviewedResponses: Array.isArray(data.reviewedResponses) ? data.reviewedResponses : [],
    submittedAnswers:
      isRecord(data.submittedAnswers)
        ? (data.submittedAnswers as StudentSessionSnapshot['submittedAnswers'])
        : {},
    revealedQuestions: Array.isArray(data.revealedQuestions)
      ? data.revealedQuestions
        .map(normalizeStudentQuestion)
        .filter((question): question is StudentQuestion => question !== null)
      : [],
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

  const fetchSnapshot = useCallback(async () => {
    if (sessionId === null) return
    try {
      const query = studentId ? `?studentId=${encodeURIComponent(studentId)}` : ''
      const resp = await fetch(`/api/resonance/${sessionId}/state${query}`)
      if (!mountedRef.current) return
      if (!resp.ok) {
        setError('Could not load session state')
        setLoading(false)
        return
      }
      const data = normalizeStudentSessionSnapshot((await resp.json()) as Partial<StudentSessionSnapshot>)
      if (!mountedRef.current) return
      if (data === null) {
        setError('Could not load session state')
        setLoading(false)
        return
      }
      setSnapshot(data)
      setError(null)
      setLoading(false)
    } catch {
      if (mountedRef.current) setError('Network error — retrying…')
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
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectDelay = 1_000
        stopFallback()
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(String(event.data)) as { type?: string; payload?: unknown }
          if (msg.type === 'resonance:session-state' && msg.payload !== undefined) {
            const normalized = normalizeStudentSessionSnapshot(msg.payload as Partial<StudentSessionSnapshot>)
            if (normalized) {
              setSnapshot(normalized)
            }
            setLoading(false)
            setError(null)
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
        wsRef.current = null
        ws = null
        if (!closed && mountedRef.current) {
          reconnectTimeoutId = setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
          // Poll while disconnected
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
  }, [sessionId, studentId, fetchSnapshot])

  /** Send a message to the server via the WebSocket. Returns true if sent. */
  const sendMessage = useCallback((type: string, payload: unknown): boolean => {
    const currentWs = wsRef.current
    if (currentWs?.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify({ type, payload }))
      return true
    }
    return false
  }, [])

  return { snapshot, loading, error, refresh: fetchSnapshot, sendMessage }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudentSessionSnapshot } from '../../shared/types.js'

const FALLBACK_POLL_INTERVAL_MS = 15_000

function normalizeStudentSessionSnapshot(
  data: Partial<StudentSessionSnapshot> | null | undefined,
): StudentSessionSnapshot | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const activeQuestions = Array.isArray(data.activeQuestions) ? data.activeQuestions : []
  const fallbackActiveQuestion =
    data.activeQuestion && typeof data.activeQuestion === 'object' ? data.activeQuestion : null
  const activeQuestionIds = Array.isArray(data.activeQuestionIds)
    ? data.activeQuestionIds.filter((entry): entry is string => typeof entry === 'string')
    : fallbackActiveQuestion
      ? [fallbackActiveQuestion.id]
      : []

  return {
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
    activeQuestion: activeQuestions[0] ?? fallbackActiveQuestion,
    activeQuestions: activeQuestions.length > 0
      ? activeQuestions
      : fallbackActiveQuestion
        ? [fallbackActiveQuestion]
        : [],
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
      data.submittedAnswers && typeof data.submittedAnswers === 'object'
        ? (data.submittedAnswers as StudentSessionSnapshot['submittedAnswers'])
        : {},
    revealedQuestions: Array.isArray(data.revealedQuestions) ? data.revealedQuestions : [],
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

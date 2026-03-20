import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  InstructorAnnotation,
  InstructorSessionSnapshot,
  QuestionReveal,
  ResponseWithName,
  Student,
} from '../../shared/types.js'

const FALLBACK_POLL_INTERVAL_MS = 10_000

/** Full instructor snapshot returned by GET /api/resonance/:sessionId/responses */
export interface InstructorStateSnapshot extends InstructorSessionSnapshot {
  responseOrderOverrides: Record<string, string[]>
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

  const fetchSnapshot = useCallback(async () => {
    if (sessionId === null || passcode === null) return
    try {
      const resp = await fetch(`/api/resonance/${sessionId}/responses`, {
        headers: { 'X-Instructor-Passcode': passcode },
      })
      if (!mountedRef.current) return
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
        students: Student[]
        responses: ResponseWithName[]
        annotations: Record<string, InstructorAnnotation>
        reveals: QuestionReveal[]
        responseOrderOverrides: Record<string, string[]>
      }
      if (!mountedRef.current) return
      setSnapshot(data as unknown as InstructorStateSnapshot)
      setError(null)
      setLoading(false)
    } catch {
      if (mountedRef.current) setError('Network error — retrying…')
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
          if (msg.type === 'resonance:instructor-state' && msg.payload !== undefined) {
            setSnapshot(msg.payload as InstructorStateSnapshot)
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

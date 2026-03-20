import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudentSessionSnapshot } from '../../shared/types.js'

const FALLBACK_POLL_INTERVAL_MS = 15_000

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
      const resp = await fetch(`/api/resonance/${sessionId}/state`)
      if (!mountedRef.current) return
      if (!resp.ok) {
        setError('Could not load session state')
        setLoading(false)
        return
      }
      const data = (await resp.json()) as StudentSessionSnapshot
      if (!mountedRef.current) return
      setSnapshot(data)
      setError(null)
      setLoading(false)
    } catch {
      if (mountedRef.current) setError('Network error — retrying…')
    }
  }, [sessionId])

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
            setSnapshot(msg.payload as StudentSessionSnapshot)
            setLoading(false)
            setError(null)
          } else if (
            msg.type === 'resonance:results-shared' ||
            msg.type === 'resonance:question-activated' ||
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

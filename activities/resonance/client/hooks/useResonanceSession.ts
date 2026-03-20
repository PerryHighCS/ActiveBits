import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudentSessionSnapshot } from '../../shared/types.js'

const POLL_INTERVAL_MS = 3000

/**
 * Polls GET /api/resonance/:sessionId/state on an interval and returns the
 * latest student-safe session snapshot.
 *
 * The polling interval will be replaced with real-time WebSocket pushes in
 * Phase 7 — this hook is the stable abstraction boundary for that upgrade.
 */
export function useResonanceSession(sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<StudentSessionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
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
      if (mountedRef.current) {
        setError('Network error — retrying…')
      }
    }
  }, [sessionId])

  useEffect(() => {
    mountedRef.current = true
    void poll()
    const interval = setInterval(() => {
      void poll()
    }, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [poll])

  return { snapshot, loading, error, refresh: poll }
}

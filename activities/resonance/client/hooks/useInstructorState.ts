import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  InstructorAnnotation,
  InstructorSessionSnapshot,
  QuestionReveal,
  ResponseWithName,
  Student,
} from '../../shared/types.js'

const POLL_INTERVAL_MS = 2000

/** Full instructor snapshot returned by GET /api/resonance/:sessionId/responses */
export interface InstructorStateSnapshot extends InstructorSessionSnapshot {
  responseOrderOverrides: Record<string, string[]>
}

/**
 * Polls the instructor responses endpoint and returns the full session state.
 * Phase 7 will upgrade this to WebSocket push notifications.
 */
export function useInstructorState(sessionId: string | null, passcode: string | null) {
  const [snapshot, setSnapshot] = useState<InstructorStateSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
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

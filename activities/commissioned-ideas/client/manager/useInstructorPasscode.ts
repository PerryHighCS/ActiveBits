import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  hasRouterStatePasscode,
  recoverInstructorPasscodeOnce,
  resolveCommissionedIdeasInstructorPasscode,
} from './passcode.js'

export type InstructorPasscodeState =
  | { status: 'loading'; passcode: null }
  | { status: 'ready'; passcode: string }
  | { status: 'missing'; passcode: null }
  /**
   * Recovery timed out or the server was unavailable; the manager cookie may already be
   * valid, or the server may recover, so a retry can work.
   */
  | { status: 'retryable'; passcode: null; reason: 'timeout' | 'unavailable' }

/**
 * Resolves the manager's instructor passcode without browser storage:
 * 1. same-tab handoff (router state or in-memory bootstrap), then clear router
 *    state so the passcode does not linger in `window.history.state`;
 * 2. otherwise (a reload), the httpOnly capability-cookie exchange.
 */
export function useCommissionedIdeasInstructorPasscode(
  sessionId: string | undefined,
): InstructorPasscodeState & { retry: () => void } {
  const location = useLocation()
  const navigate = useNavigate()
  const [state, setState] = useState<{ sessionId: string | undefined; value: InstructorPasscodeState }>({
    sessionId,
    value: { status: 'loading', passcode: null },
  })
  // Bumped by `retry` to run recovery again for the same session.
  const [attempt, setAttempt] = useState(0)

  // Read through refs so clearing router state (which changes `location`) does
  // not re-run resolution and lose the passcode we already hold.
  const locationRef = useRef(location)
  locationRef.current = location
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!sessionId) {
      setState({ sessionId, value: { status: 'missing', passcode: null } })
      return
    }

    const current = locationRef.current
    const handoff = resolveCommissionedIdeasInstructorPasscode({ sessionId, locationState: current.state })
    if (handoff) {
      setState({ sessionId, value: { status: 'ready', passcode: handoff } })
      if (hasRouterStatePasscode(current.state)) {
        void navigateRef.current(current.pathname + current.search, { replace: true, state: null })
      }
      return
    }

    let cancelled = false
    setState({ sessionId, value: { status: 'loading', passcode: null } })
    void recoverInstructorPasscodeOnce(sessionId).then((outcome) => {
      if (cancelled) return
      setState({
        sessionId,
        value: outcome.status === 'ok'
          ? { status: 'ready', passcode: outcome.passcode }
          : outcome.status === 'timeout' || outcome.status === 'unavailable'
            ? { status: 'retryable', passcode: null, reason: outcome.status }
            : { status: 'missing', passcode: null },
      })
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, attempt])

  const value = state.sessionId === sessionId ? state.value : { status: 'loading' as const, passcode: null }
  return { ...value, retry: () => setAttempt((n) => n + 1) }
}

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  hasRouterStatePasscode,
  recoverCommissionedIdeasInstructorPasscode,
  resolveCommissionedIdeasInstructorPasscode,
} from './passcode.js'

export type InstructorPasscodeState =
  | { status: 'loading'; passcode: null }
  | { status: 'ready'; passcode: string }
  | { status: 'missing'; passcode: null }

/**
 * Resolves the manager's instructor passcode without browser storage:
 * 1. same-tab handoff (router state or in-memory bootstrap), then clear router
 *    state so the passcode does not linger in `window.history.state`;
 * 2. otherwise (a reload), the httpOnly capability-cookie exchange.
 */
export function useCommissionedIdeasInstructorPasscode(sessionId: string | undefined): InstructorPasscodeState {
  const location = useLocation()
  const navigate = useNavigate()
  const [state, setState] = useState<{ sessionId: string | undefined; value: InstructorPasscodeState }>({
    sessionId,
    value: { status: 'loading', passcode: null },
  })

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
    void recoverCommissionedIdeasInstructorPasscode(sessionId).then((passcode) => {
      if (cancelled) return
      setState({
        sessionId,
        value: passcode ? { status: 'ready', passcode } : { status: 'missing', passcode: null },
      })
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  return state.sessionId === sessionId ? state.value : { status: 'loading', passcode: null }
}

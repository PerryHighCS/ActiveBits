import { useCallback, useEffect, useRef, type RefObject } from 'react'

/** The request's state as the focus restorer sees it. */
export type FocusRequestOutcome = 'pending' | 'committed' | 'refused' | 'unknown'

export interface FocusRestoreDecision {
  /** Where to move focus now, or null to leave it alone. */
  focus: 'target' | 'origin' | null
  /** Whether to keep watching renders for the control's removal. */
  keepTracking: boolean
}

/**
 * What to do after a render or a settled request. Restoration only replaces focus the
 * action took away: focus is on nothing (the body). The user moving focus to another
 * control cancels tracking elsewhere (a focusin listener).
 * - The activated control was removed (the change landed, possibly by snapshot while
 *   the response was lost): focus the stable target and stop.
 * - The control is still there but disabled (busy): focusing it would do nothing, so
 *   wait for the render that enables it.
 * - Refused: nothing will change, so focus the control again and stop.
 * - Unknown outcome: the change may still land, so focus the control again but keep
 *   watching; a later snapshot that removes it then moves focus to the target.
 * - Pending or committed (the snapshot has not removed it yet): keep waiting.
 */
export function focusRestoreDecision(state: {
  outcome: FocusRequestOutcome
  originConnected: boolean
  originFocusable: boolean
  focusLost: boolean
}): FocusRestoreDecision {
  const { outcome, originConnected, originFocusable, focusLost } = state
  if (!focusLost) return { focus: null, keepTracking: outcome !== 'refused' }
  if (!originConnected) return { focus: 'target', keepTracking: false }
  if (!originFocusable) return { focus: null, keepTracking: true }
  if (outcome === 'refused') return { focus: 'origin', keepTracking: false }
  if (outcome === 'unknown') return { focus: 'origin', keepTracking: true }
  return { focus: null, keepTracking: true }
}

function isFocusable(control: HTMLElement): boolean {
  return !control.matches(':disabled')
}

/**
 * Keeps keyboard focus in place when an action (Join, Switch, Leave, Create) removes the
 * control that triggered it. The removal is detected from the rendered DOM, so it also
 * works when the change arrives by snapshot while the HTTP response is lost.
 */
export function useRestoreFocusAfterRemoval(target: RefObject<HTMLElement | null>) {
  const origin = useRef<HTMLElement | null>(null)
  const outcome = useRef<FocusRequestOutcome>('pending')

  const check = useCallback(() => {
    const control = origin.current
    if (!control) return
    const active = document.activeElement
    const decision = focusRestoreDecision({
      outcome: outcome.current,
      originConnected: control.isConnected,
      originFocusable: isFocusable(control),
      focusLost: active === null || active === document.body,
    })
    if (!decision.keepTracking) origin.current = null
    if (decision.focus === 'target') target.current?.focus()
    else if (decision.focus === 'origin') control.focus()
  }, [target])

  // Focus moving to any other control means the user moved on: cancel.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (origin.current && event.target !== origin.current) origin.current = null
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  // Every render may have removed the control (a snapshot applied the change) or
  // re-enabled it (the request is no longer busy).
  useEffect(() => { check() })

  return {
    /** Call when the action starts, with the control the user activated. */
    begin(control: HTMLElement) {
      origin.current = control
      outcome.current = 'pending'
    },
    /** Call when the request settles. */
    settle(result: Exclude<FocusRequestOutcome, 'pending'>) {
      outcome.current = result
      check()
    },
  }
}

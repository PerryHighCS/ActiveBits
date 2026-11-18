import { useCallback, useEffect, useRef, type RefObject } from 'react'

/**
 * Where focus should go after an action, or null to leave it alone. Restoration only
 * replaces focus the action took away: focus is on nothing (the body), and the user
 * has not moved it to another control (that cancels the request elsewhere).
 * - The activated control was removed (the change landed): focus the stable target.
 * - The request failed and the control is still there: focus it again (it was
 *   disabled while busy, which drops focus).
 */
export function focusRestoreTarget(state: {
  originConnected: boolean
  focusLost: boolean
  requestFailed: boolean
}): 'target' | 'origin' | null {
  if (!state.focusLost) return null
  if (!state.originConnected) return 'target'
  return state.requestFailed ? 'origin' : null
}

/**
 * Keeps keyboard focus in place when an action (Join, Switch, Leave, Create) removes the
 * control that triggered it. The removal is detected from the rendered DOM, so it also
 * works when the change arrives by snapshot while the HTTP response is lost.
 */
export function useRestoreFocusAfterRemoval(target: RefObject<HTMLElement | null>) {
  const origin = useRef<HTMLElement | null>(null)
  const failed = useRef(false)

  const check = useCallback(() => {
    const control = origin.current
    if (!control) return
    const active = document.activeElement
    const where = focusRestoreTarget({
      originConnected: control.isConnected,
      focusLost: active === null || active === document.body,
      requestFailed: failed.current,
    })
    if (where === null) return
    origin.current = null
    if (where === 'target') target.current?.focus()
    else control.focus()
  }, [target])

  // Focus moving to any other control means the user moved on: cancel.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (origin.current && event.target !== origin.current) origin.current = null
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  // Every render may have removed the control (a snapshot applied the change).
  useEffect(() => { check() })

  return {
    /** Call when the action starts, with the control the user activated. */
    begin(control: HTMLElement) {
      origin.current = control
      failed.current = false
    },
    /** Call when the request settles. */
    settle(ok: boolean) {
      failed.current = !ok
      check()
    },
  }
}

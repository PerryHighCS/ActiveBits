/** Marks each late-arrival row's focusable controls (placement select, Reject) with the participant id. */
export const LATE_ARRIVAL_CONTROL_ATTR = 'data-late-arrival-control'

interface FocusCandidate {
  getAttribute(name: string): string | null
  matches(selector: string): boolean
}

/**
 * Where focus goes after a late arrival's row is removed (placed or rejected):
 * 1. an enabled control (placement select, then Reject) of the student who was next to
 *    it (`preferredId`), else an enabled control of any waiting student. A placement
 *    select stays disabled when there are no teams, so Reject is the fallback.
 * 2. While every control is disabled (the request is still busy), that row's first
 *    control anyway: the caller waits until it can take focus.
 * 3. When nobody is waiting, the "all placed" status that replaces the list.
 */
export function lateArrivalFocusTarget<T extends FocusCandidate>(
  /** The rows' controls in list order (elements carrying LATE_ARRIVAL_CONTROL_ATTR). */
  controls: readonly T[],
  preferredId: string | null,
  allPlaced: T | null,
): T | null {
  if (controls.length === 0) return allPlaced
  const enabled = controls.filter((el) => !el.matches(':disabled'))
  const preferred = (from: readonly T[]) => from.find((el) => el.getAttribute(LATE_ARRIVAL_CONTROL_ATTR) === preferredId)
  return preferred(enabled) ?? enabled[0] ?? preferred(controls) ?? controls[0] ?? allPlaced
}

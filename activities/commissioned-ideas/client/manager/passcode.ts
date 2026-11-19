import { readCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'

interface ManagerPasscodeSources {
  sessionId: string | undefined
  locationState: unknown
  readBootstrapPayload?: typeof readCreateSessionBootstrapPayload
}

function getPasscode(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Resolve the same-tab manager handoff without consuming it during React effect replay. */
export function resolveCommissionedIdeasInstructorPasscode({
  sessionId,
  locationState,
  readBootstrapPayload = readCreateSessionBootstrapPayload,
}: ManagerPasscodeSources): string | null {
  if (!sessionId) return null

  if (locationState != null && typeof locationState === 'object' && !Array.isArray(locationState)) {
    const payload = (locationState as Record<string, unknown>).createSessionPayload
    if (payload != null && typeof payload === 'object' && !Array.isArray(payload)) {
      const fromRouterState = getPasscode((payload as Record<string, unknown>).instructorPasscode)
      if (fromRouterState) return fromRouterState
    }
  }

  return getPasscode(readBootstrapPayload('commissioned-ideas', sessionId)?.instructorPasscode)
}

/** True when router state carries a passcode, which the manager clears after reading. */
export function hasRouterStatePasscode(locationState: unknown): boolean {
  if (locationState == null || typeof locationState !== 'object' || Array.isArray(locationState)) return false
  const payload = (locationState as Record<string, unknown>).createSessionPayload
  return payload != null && typeof payload === 'object' && !Array.isArray(payload)
    && getPasscode((payload as Record<string, unknown>).instructorPasscode) !== null
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

async function exchangeCapabilityForPasscode(
  sessionId: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<{ passcode: string | null; status: number }> {
  const response = await fetchImpl(`/api/commissioned-ideas/${encodeURIComponent(sessionId)}/instructor-passcode`, {
    credentials: 'include',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) return { passcode: null, status: response.status }
  const body = (await response.json()) as { instructorPasscode?: unknown }
  return { passcode: getPasscode(body.instructorPasscode), status: response.status }
}

/**
 * A server error or rate limit says nothing about whether access exists; a retry
 * later can succeed. Only an answer (403, 404, or a body without a passcode) is final.
 */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429
}

/**
 * Result of one recovery attempt:
 * - `ok`: the passcode;
 * - `missing`: the server answered that this browser has no manager access (final);
 * - `unavailable`: a server error, rate limit, or network failure; a retry can succeed.
 */
export type RecoveryAttemptResult =
  | { status: 'ok'; passcode: string }
  | { status: 'missing' }
  | { status: 'unavailable' }

/**
 * Reload recovery (see the "Manager reload recovery" contract in the activity plan):
 * exchange the httpOnly manager capability cookie for the passcode. If the cookie is
 * missing or expired (403), ask core to reissue it from the persistent-link teacher
 * cookie once, then retry the exchange once.
 */
export async function recoverCommissionedIdeasInstructorPasscode(
  sessionId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  signal?: AbortSignal,
): Promise<RecoveryAttemptResult> {
  const fromExchange = (result: { passcode: string | null; status: number }): RecoveryAttemptResult =>
    result.passcode ? { status: 'ok', passcode: result.passcode }
      : isTransientStatus(result.status) ? { status: 'unavailable' }
        : { status: 'missing' }
  try {
    const first = await exchangeCapabilityForPasscode(sessionId, fetchImpl, signal)
    if (first.passcode || first.status !== 403) return fromExchange(first)

    const reissue = await fetchImpl(`/api/session/${encodeURIComponent(sessionId)}/persistent-manager-capability`, {
      method: 'POST',
      credentials: 'include',
      ...(signal ? { signal } : {}),
    })
    if (!reissue.ok) return isTransientStatus(reissue.status) ? { status: 'unavailable' } : { status: 'missing' }

    return fromExchange(await exchangeCapabilityForPasscode(sessionId, fetchImpl, signal))
  } catch {
    // Network failure (or an abort at the deadline, which reports `timeout` instead).
    return { status: 'unavailable' }
  }
}

/**
 * Result of a shared recovery. `timeout` and `unavailable` are retryable and distinct
 * from `missing`: the reissue may already have set a valid manager cookie, or the
 * server may recover, so a retry (which starts with the cookie exchange) can succeed.
 */
export type RecoveryOutcome = RecoveryAttemptResult | { status: 'timeout' }

const inFlightRecoveries = new Map<string, Promise<RecoveryOutcome>>()

/** Upper bound for one shared recovery, including reading response bodies. */
export const RECOVERY_DEADLINE_MS = 15_000

/**
 * One in-flight recovery per session. React Strict Mode runs the recovery effect twice
 * in development; without sharing, the cancelled run's reissue can succeed while the
 * live run's reissue is rate-limited, and the live run would report `missing` although
 * the cookie is valid. The entry is dropped once settled so a later reload recovers again.
 *
 * A deadline bounds the shared recovery: a stalled request (for example a response body
 * that never finishes) is aborted and the recovery settles as `null`, which clears the
 * entry, so a retry or reopening the manager starts a fresh recovery instead of waiting
 * forever. The outcome is `timeout` (retryable), not `missing`.
 */
export function recoverInstructorPasscodeOnce(
  sessionId: string,
  fetchImpl?: FetchLike,
  deadlineMs = RECOVERY_DEADLINE_MS,
): Promise<RecoveryOutcome> {
  const existing = inFlightRecoveries.get(sessionId)
  if (existing) return existing
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<RecoveryOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ status: 'timeout' })
    }, deadlineMs)
  })
  const attempt: Promise<RecoveryOutcome> = recoverCommissionedIdeasInstructorPasscode(sessionId, fetchImpl, controller.signal)
  const recovery = Promise.race([attempt, deadline]).finally(() => {
    clearTimeout(timer)
    inFlightRecoveries.delete(sessionId)
  })
  inFlightRecoveries.set(sessionId, recovery)
  return recovery
}

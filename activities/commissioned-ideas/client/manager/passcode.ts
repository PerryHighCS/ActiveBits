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
): Promise<{ passcode: string | null; status: number }> {
  const response = await fetchImpl(`/api/commissioned-ideas/${encodeURIComponent(sessionId)}/instructor-passcode`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) return { passcode: null, status: response.status }
  const body = (await response.json()) as { instructorPasscode?: unknown }
  return { passcode: getPasscode(body.instructorPasscode), status: response.status }
}

/**
 * Reload recovery (see the "Manager reload recovery" contract in the activity plan):
 * exchange the httpOnly manager capability cookie for the passcode. If the cookie is
 * missing or expired (403), ask core to reissue it from the persistent-link teacher
 * cookie once, then retry the exchange once. Returns null when no path succeeds.
 */
export async function recoverCommissionedIdeasInstructorPasscode(
  sessionId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<string | null> {
  try {
    const first = await exchangeCapabilityForPasscode(sessionId, fetchImpl)
    if (first.passcode || first.status !== 403) return first.passcode

    const reissue = await fetchImpl(`/api/session/${encodeURIComponent(sessionId)}/persistent-manager-capability`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!reissue.ok) return null

    return (await exchangeCapabilityForPasscode(sessionId, fetchImpl)).passcode
  } catch {
    return null
  }
}

const inFlightRecoveries = new Map<string, Promise<string | null>>()

/**
 * One in-flight recovery per session. React Strict Mode runs the recovery effect twice
 * in development; without sharing, the cancelled run's reissue can succeed while the
 * live run's reissue is rate-limited, and the live run would report `missing` although
 * the cookie is valid. The entry is dropped once settled so a later reload recovers again.
 */
export function recoverInstructorPasscodeOnce(
  sessionId: string,
  fetchImpl?: FetchLike,
): Promise<string | null> {
  const existing = inFlightRecoveries.get(sessionId)
  if (existing) return existing
  const recovery = recoverCommissionedIdeasInstructorPasscode(sessionId, fetchImpl).finally(() => {
    inFlightRecoveries.delete(sessionId)
  })
  inFlightRecoveries.set(sessionId, recovery)
  return recovery
}

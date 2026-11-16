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

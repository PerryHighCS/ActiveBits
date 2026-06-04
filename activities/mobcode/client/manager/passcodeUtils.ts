import { consumeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import { MOB_CODE_INSTRUCTOR_STORAGE_PREFIX } from '../utils/constants'

function readLocationStatePasscode(locationState: unknown): string {
  const state = locationState != null && typeof locationState === 'object'
    ? (locationState as Record<string, unknown>)
    : {}
  const value = state.instructorPasscode
  return typeof value === 'string' && value.length > 0 ? value : ''
}

export function resolveMobCodeInstructorPasscode(params: {
  sessionId: string | undefined
  locationState: unknown
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  consumeBootstrapPayload?: typeof consumeCreateSessionBootstrapPayload
}): string {
  const fromLocationState = readLocationStatePasscode(params.locationState)
  if (fromLocationState) {
    return fromLocationState
  }

  if (!params.sessionId) {
    return ''
  }

  const storage = params.storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage)
  const storageKey = `${MOB_CODE_INSTRUCTOR_STORAGE_PREFIX}${params.sessionId}`
  const fromStorage = storage?.getItem(storageKey) ?? ''
  if (fromStorage) {
    return fromStorage
  }

  const consumeBootstrapPayload = params.consumeBootstrapPayload ?? consumeCreateSessionBootstrapPayload
  const bootstrap = consumeBootstrapPayload('mobcode', params.sessionId)
  const fromBootstrap = typeof bootstrap?.instructorPasscode === 'string' ? bootstrap.instructorPasscode : ''
  if (!fromBootstrap) {
    return ''
  }

  try {
    storage?.setItem(storageKey, fromBootstrap)
  } catch {
    // Best-effort persistence only; the in-memory passcode still allows manager auth.
  }

  return fromBootstrap
}

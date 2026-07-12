import { readCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import { MOB_CODE_INSTRUCTOR_STORAGE_PREFIX } from '../utils/constants'

function readLocationStatePasscode(locationState: unknown): string {
  const state = locationState != null && typeof locationState === 'object'
    ? (locationState as Record<string, unknown>)
    : {}
  const nestedPayload = state.createSessionPayload != null && typeof state.createSessionPayload === 'object'
    ? state.createSessionPayload as Record<string, unknown>
    : null
  const nestedValue = nestedPayload?.instructorPasscode
  if (typeof nestedValue === 'string' && nestedValue.length > 0) {
    return nestedValue
  }

  const value = state.instructorPasscode
  return typeof value === 'string' && value.length > 0 ? value : ''
}

export function resolveMobCodeInstructorPasscode(params: {
  sessionId: string | undefined
  locationState: unknown
  storage?: Pick<Storage, 'getItem'> | null
  readBootstrapPayload?: typeof readCreateSessionBootstrapPayload
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

  const readBootstrapPayload = params.readBootstrapPayload ?? readCreateSessionBootstrapPayload
  const bootstrap = readBootstrapPayload('mobcode', params.sessionId)
  const fromBootstrap = typeof bootstrap?.instructorPasscode === 'string' ? bootstrap.instructorPasscode : ''
  return fromBootstrap || ''
}

export function readEmbeddedManagerToken(search: string): string | null {
  const token = new URLSearchParams(search).get('embeddedManagerToken')
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null
}

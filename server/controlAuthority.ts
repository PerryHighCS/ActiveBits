import type {
  ActivityConfig,
  ResolvedControlAuthority,
  SessionControlAuthorityState,
} from '../types/activity.js'
import type { SessionRecord } from './core/sessions.js'

interface ControlAuthoritySessionLike {
  id: string
  data?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function ensureSessionDataRecord(session: Pick<SessionRecord, 'data'>): Record<string, unknown> {
  if (isPlainObject(session.data)) {
    return session.data
  }

  const nextData: Record<string, unknown> = {}
  ;(session as SessionRecord).data = nextData
  return nextData
}

export function normalizeInstructorInstanceId(value: unknown): string | null {
  return normalizeNonEmptyString(value)
}

export function normalizeSessionControlAuthorityState(value: unknown): SessionControlAuthorityState {
  const source = isPlainObject(value) ? value : {}

  return {
    mode: 'single-instructor',
    ownerInstanceId: normalizeNonEmptyString(source.ownerInstanceId),
    ownerTakenAt: normalizeFiniteNumber(source.ownerTakenAt),
    overrideInherited: source.overrideInherited === true,
  }
}

export function getSessionControlAuthorityState(session: Pick<SessionRecord, 'data'>): SessionControlAuthorityState {
  const data = isPlainObject(session.data) ? session.data : {}
  return normalizeSessionControlAuthorityState(data.controlAuthority)
}

export function setSessionControlAuthorityState(
  session: Pick<SessionRecord, 'data'>,
  state: SessionControlAuthorityState,
): SessionControlAuthorityState {
  const data = ensureSessionDataRecord(session)
  data.controlAuthority = {
    mode: 'single-instructor',
    ownerInstanceId: state.ownerInstanceId,
    ownerTakenAt: state.ownerTakenAt,
    overrideInherited: state.overrideInherited,
  } satisfies SessionControlAuthorityState

  return getSessionControlAuthorityState(session)
}

export function claimSessionControlAuthority(params: {
  session: Pick<SessionRecord, 'data'>
  instructorInstanceId: string
  takenAt?: number
  overrideInherited?: boolean
}): SessionControlAuthorityState {
  const normalizedInstructorInstanceId = normalizeInstructorInstanceId(params.instructorInstanceId)
  if (!normalizedInstructorInstanceId) {
    throw new Error('claimSessionControlAuthority requires a non-empty instructorInstanceId')
  }

  return setSessionControlAuthorityState(params.session, {
    mode: 'single-instructor',
    ownerInstanceId: normalizedInstructorInstanceId,
    ownerTakenAt: normalizeFiniteNumber(params.takenAt) ?? Date.now(),
    overrideInherited: params.overrideInherited === true,
  })
}

export function getEmbeddedParentSessionId(session: ControlAuthoritySessionLike | null | undefined): string | null {
  const data = isPlainObject(session?.data) ? session.data : {}
  return normalizeNonEmptyString(data.embeddedParentSessionId)
}

function getConfiguredControlAuthorityScope(activityConfig: ActivityConfig | null | undefined): 'session' | 'inherited' {
  return activityConfig?.controlAuthority?.scope === 'inherited' ? 'inherited' : 'session'
}

export function activityUsesControlAuthority(activityConfig: ActivityConfig | null | undefined): boolean {
  return activityConfig?.controlAuthority?.mode === 'single-instructor'
}

export function resolveControlAuthority(params: {
  session: ControlAuthoritySessionLike
  activityConfig: ActivityConfig | null | undefined
  parentSession?: ControlAuthoritySessionLike | null
  parentActivityConfig?: ActivityConfig | null | undefined
}): ResolvedControlAuthority | null {
  const { session, activityConfig, parentSession = null, parentActivityConfig = null } = params
  if (!activityUsesControlAuthority(activityConfig)) {
    return null
  }

  const configuredScope = getConfiguredControlAuthorityScope(activityConfig)
  const localState = getSessionControlAuthorityState(session as Pick<SessionRecord, 'data'>)
  const embeddedParentSessionId = getEmbeddedParentSessionId(session)
  const canInherit =
    configuredScope === 'inherited'
    && localState.overrideInherited !== true
    && embeddedParentSessionId != null
    && parentSession?.id === embeddedParentSessionId
    && activityUsesControlAuthority(parentActivityConfig)

  if (canInherit) {
    return {
      mode: 'single-instructor',
      configuredScope,
      effectiveScope: 'inherited',
      authoritySessionId: parentSession.id,
      inheritedFromSessionId: parentSession.id,
    }
  }

  return {
    mode: 'single-instructor',
    configuredScope,
    effectiveScope: 'session',
    authoritySessionId: session.id,
    inheritedFromSessionId: null,
  }
}

export function getResolvedControlAuthorityOwnerInstanceId(params: {
  resolvedAuthority: ResolvedControlAuthority | null
  session: Pick<SessionRecord, 'data'>
  parentSession?: Pick<SessionRecord, 'data'> | null
}): string | null {
  const { resolvedAuthority, session, parentSession = null } = params
  if (!resolvedAuthority) {
    return null
  }

  if (resolvedAuthority.effectiveScope === 'inherited') {
    return parentSession ? getSessionControlAuthorityState(parentSession).ownerInstanceId : null
  }

  return getSessionControlAuthorityState(session).ownerInstanceId
}

export function isInstructorControlOwner(params: {
  resolvedAuthority: ResolvedControlAuthority | null
  session: Pick<SessionRecord, 'data'>
  instructorInstanceId: string | null | undefined
  parentSession?: Pick<SessionRecord, 'data'> | null
}): boolean {
  const normalizedInstructorInstanceId = normalizeInstructorInstanceId(params.instructorInstanceId)
  if (!normalizedInstructorInstanceId) {
    return false
  }

  const ownerInstanceId = getResolvedControlAuthorityOwnerInstanceId(params)
  return ownerInstanceId === normalizedInstructorInstanceId
}

export function shouldAutoClaimControlAuthority(params: {
  resolvedAuthority: ResolvedControlAuthority | null
  session: Pick<SessionRecord, 'data'>
  parentSession?: Pick<SessionRecord, 'data'> | null
}): boolean {
  return getResolvedControlAuthorityOwnerInstanceId(params) == null
}

export default {
  activityUsesControlAuthority,
  claimSessionControlAuthority,
  getEmbeddedParentSessionId,
  getResolvedControlAuthorityOwnerInstanceId,
  getSessionControlAuthorityState,
  isInstructorControlOwner,
  normalizeInstructorInstanceId,
  normalizeSessionControlAuthorityState,
  resolveControlAuthority,
  setSessionControlAuthorityState,
  shouldAutoClaimControlAuthority,
}

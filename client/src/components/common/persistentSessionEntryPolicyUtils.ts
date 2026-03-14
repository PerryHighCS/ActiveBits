import type {
  PersistentSessionEntryPolicy,
  WaitingRoomEntryOutcome,
  WaitingRoomPresentationMode,
  WaitingRoomResolvedRole,
} from '../../../../types/waitingRoom.js'

const DEFAULT_ENTRY_POLICY: PersistentSessionEntryPolicy = 'instructor-required'

function normalizePersistentSessionEntryPolicy(value: unknown): PersistentSessionEntryPolicy {
  return value === 'solo-allowed' || value === 'solo-only' || value === 'instructor-required'
    ? value
    : DEFAULT_ENTRY_POLICY
}

export interface PersistentSessionEntryPolicyOption {
  value: PersistentSessionEntryPolicy
  label: string
  description: string
}

export type PersistentSessionEntryOutcome = WaitingRoomEntryOutcome

export type PersistentSessionResolvedRole = WaitingRoomResolvedRole

export type PersistentSessionPresentationMode = WaitingRoomPresentationMode

export type PersistentSessionTeacherIntent = 'none' | 'cookie' | 'code'

export const PERSISTENT_SESSION_ENTRY_POLICY_OPTIONS: readonly PersistentSessionEntryPolicyOption[] = [
  {
    value: 'instructor-required',
    label: 'Live Only',
    description: 'Students wait for a teacher before they can enter.',
  },
  {
    value: 'solo-allowed',
    label: 'Live Or Solo',
    description: 'Students join the live session when it is running, or continue solo when no teacher is present.',
  },
  {
    value: 'solo-only',
    label: 'Solo Only',
    description: 'This link always opens solo mode and never starts a managed live session.',
  },
] as const

export interface ResolvePersistentSessionEntryParams {
  entryPolicy?: PersistentSessionEntryPolicy
  isStarted?: boolean
  hasTeacherCookie?: boolean
  activitySupportsSolo: boolean
}

export interface ResolvePersistentSessionEntryDecisionParams {
  entryPolicy?: PersistentSessionEntryPolicy
  isStarted?: boolean
  activitySupportsSolo: boolean
  waitingRoomFieldCount?: number
  teacherIntent?: PersistentSessionTeacherIntent
}

export interface PersistentSessionEntryDecision {
  resolvedRole: PersistentSessionResolvedRole
  entryOutcome: PersistentSessionEntryOutcome
  presentationMode: PersistentSessionPresentationMode
}

export function getPersistentSessionEntryPolicyLabel(value: unknown): string {
  const normalized = normalizePersistentSessionEntryPolicy(value)
  return PERSISTENT_SESSION_ENTRY_POLICY_OPTIONS.find((option) => option.value === normalized)?.label ?? 'Live Only'
}

export function getPersistentSessionEntryPolicyDescription(value: unknown): string {
  const normalized = normalizePersistentSessionEntryPolicy(value)
  return PERSISTENT_SESSION_ENTRY_POLICY_OPTIONS.find((option) => option.value === normalized)?.description
    ?? 'Students wait for a teacher before they can enter.'
}

export function resolvePersistentSessionEntryOutcome({
  entryPolicy = DEFAULT_ENTRY_POLICY,
  isStarted = false,
  hasTeacherCookie = false,
  activitySupportsSolo,
}: ResolvePersistentSessionEntryParams): PersistentSessionEntryOutcome {
  const normalizedPolicy = normalizePersistentSessionEntryPolicy(entryPolicy)

  if (normalizedPolicy === 'solo-only') {
    return activitySupportsSolo ? 'continue-solo' : 'solo-unavailable'
  }

  if (isStarted) {
    return 'join-live'
  }

  if (hasTeacherCookie) {
    return 'wait'
  }

  if (normalizedPolicy === 'solo-allowed') {
    return activitySupportsSolo ? 'continue-solo' : 'solo-unavailable'
  }

  return 'wait'
}

export function resolvePersistentSessionEntryDecision({
  entryPolicy = DEFAULT_ENTRY_POLICY,
  isStarted = false,
  activitySupportsSolo,
  waitingRoomFieldCount = 0,
  teacherIntent = 'none',
}: ResolvePersistentSessionEntryDecisionParams): PersistentSessionEntryDecision {
  const normalizedPolicy = normalizePersistentSessionEntryPolicy(entryPolicy)
  const resolvedRole: PersistentSessionResolvedRole = normalizedPolicy !== 'solo-only'
    && (teacherIntent === 'cookie' || teacherIntent === 'code')
    ? 'teacher'
    : 'student'

  const entryOutcome = resolvePersistentSessionEntryOutcome({
    entryPolicy: normalizedPolicy,
    isStarted,
    hasTeacherCookie: resolvedRole === 'teacher',
    activitySupportsSolo,
  })

  const presentationMode: PersistentSessionPresentationMode = waitingRoomFieldCount > 0 || entryOutcome === 'wait'
    ? 'render-ui'
    : 'pass-through'

  return {
    resolvedRole,
    entryOutcome,
    presentationMode,
  }
}

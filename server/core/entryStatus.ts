import type {
  PersistentSessionEntryPolicy,
  PersistentSessionEntryStatus,
  SessionEntryStatus,
  WaitingRoomEntryOutcome,
  WaitingRoomPresentationMode,
  WaitingRoomResolvedRole,
} from '../../types/waitingRoom.js'

export interface BaseEntryStatusParams {
  activityName: string
  waitingRoomFieldCount: number
  resolvedRole: WaitingRoomResolvedRole
  entryOutcome: WaitingRoomEntryOutcome
}

export function getEntryPresentationMode({
  waitingRoomFieldCount,
  entryOutcome,
}: Pick<BaseEntryStatusParams, 'waitingRoomFieldCount' | 'entryOutcome'>): WaitingRoomPresentationMode {
  return waitingRoomFieldCount > 0 || entryOutcome === 'wait'
    ? 'render-ui'
    : 'pass-through'
}

export function buildSessionEntryStatus({
  sessionId,
  activityName,
  waitingRoomFieldCount,
  resolvedRole,
  entryOutcome,
}: BaseEntryStatusParams & { sessionId: string }): SessionEntryStatus {
  return {
    sessionId,
    activityName,
    waitingRoomFieldCount,
    resolvedRole,
    entryOutcome,
    presentationMode: getEntryPresentationMode({ waitingRoomFieldCount, entryOutcome }),
  }
}

function normalizePersistentSessionEntryPolicy(value: unknown): PersistentSessionEntryPolicy {
  return value === 'solo-allowed' || value === 'solo-only' || value === 'instructor-required'
    ? value
    : 'instructor-required'
}

export function buildPersistentEntryStatus({
  activityName,
  hash,
  entryPolicy,
  hasTeacherCookie,
  isStarted,
  sessionId,
  activitySupportsSolo,
  waitingRoomFieldCount,
}: {
  activityName: string
  hash: string
  entryPolicy?: PersistentSessionEntryPolicy
  hasTeacherCookie: boolean
  isStarted: boolean
  sessionId: string | null
  activitySupportsSolo: boolean
  waitingRoomFieldCount: number
}): PersistentSessionEntryStatus {
  const normalizedPolicy = normalizePersistentSessionEntryPolicy(entryPolicy)
  const resolvedRole: WaitingRoomResolvedRole = normalizedPolicy !== 'solo-only' && hasTeacherCookie ? 'teacher' : 'student'

  let entryOutcome: WaitingRoomEntryOutcome
  if (normalizedPolicy === 'solo-only') {
    entryOutcome = activitySupportsSolo ? 'continue-solo' : 'solo-unavailable'
  } else if (isStarted) {
    entryOutcome = 'join-live'
  } else if (resolvedRole === 'teacher') {
    entryOutcome = 'wait'
  } else if (normalizedPolicy === 'solo-allowed') {
    entryOutcome = activitySupportsSolo ? 'continue-solo' : 'solo-unavailable'
  } else {
    entryOutcome = 'wait'
  }

  return {
    activityName,
    hash,
    entryPolicy: normalizedPolicy,
    hasTeacherCookie,
    isStarted,
    sessionId,
    waitingRoomFieldCount,
    resolvedRole,
    entryOutcome,
    presentationMode: getEntryPresentationMode({ waitingRoomFieldCount, entryOutcome }),
  }
}

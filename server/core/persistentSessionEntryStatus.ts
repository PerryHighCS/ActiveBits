import type { PersistentSessionEntryPolicy, PersistentSessionEntryStatus } from '../../types/waitingRoom.js'

function normalizePersistentSessionEntryPolicy(value: unknown): PersistentSessionEntryPolicy {
  return value === 'solo-allowed' || value === 'solo-only' || value === 'instructor-required'
    ? value
    : 'instructor-required'
}

export function resolvePersistentSessionEntryStatus({
  activityName,
  hash,
  entryPolicy,
  isStarted,
  sessionId,
  hasTeacherCookie,
  activitySupportsSolo,
  waitingRoomFieldCount,
}: {
  activityName: string
  hash: string
  entryPolicy?: PersistentSessionEntryPolicy
  isStarted: boolean
  sessionId: string | null
  hasTeacherCookie: boolean
  activitySupportsSolo: boolean
  waitingRoomFieldCount: number
}): PersistentSessionEntryStatus {
  const normalizedPolicy = normalizePersistentSessionEntryPolicy(entryPolicy)
  const resolvedRole = normalizedPolicy !== 'solo-only' && hasTeacherCookie ? 'teacher' : 'student'

  let entryOutcome: PersistentSessionEntryStatus['entryOutcome']
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

  const presentationMode = waitingRoomFieldCount > 0 || entryOutcome === 'wait'
    ? 'render-ui'
    : 'pass-through'

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
    presentationMode,
  }
}

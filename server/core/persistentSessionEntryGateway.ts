import { activitySupportsSoloMode, getActivityWaitingRoomFieldCount } from '../activities/activityRegistry.js'
import {
  getOrCreateActivePersistentSession,
  resetPersistentSession,
} from './persistentSessions.js'
import { buildPersistentEntryStatus } from './entryStatus.js'
import type { PersistentSessionEntryStatus } from '../../types/waitingRoom.js'

const DEFAULT_PERSISTENT_SESSION_ENTRY_POLICY: PersistentSessionEntryStatus['entryPolicy'] = 'instructor-required'

interface SessionStoreLike {
  get(id: string): Promise<unknown | null>
}

export interface PersistentSessionEntryGatewayContext {
  activityName: string
  entryPolicy: PersistentSessionEntryStatus['entryPolicy']
  isStarted: boolean
  sessionId: string | null
  hasTeacherCookie: boolean
  waitingRoomFieldCount: number
  activitySupportsSolo: boolean
}

export async function loadPersistentSessionEntryGatewayContext({
  activityName,
  hash,
  hasTeacherCookie,
  entryPolicyOverride,
  sessions,
}: {
  activityName: string
  hash: string
  hasTeacherCookie: boolean
  entryPolicyOverride?: PersistentSessionEntryStatus['entryPolicy']
  sessions: SessionStoreLike
}): Promise<PersistentSessionEntryGatewayContext> {
  let session = await getOrCreateActivePersistentSession(activityName, hash, null, entryPolicyOverride)

  if (session.sessionId) {
    const backingSession = await sessions.get(session.sessionId)
    if (backingSession == null) {
      await resetPersistentSession(hash)
      session = await getOrCreateActivePersistentSession(activityName, hash, null, entryPolicyOverride)
    }
  }

  return {
    activityName: session.activityName,
    entryPolicy: entryPolicyOverride ?? DEFAULT_PERSISTENT_SESSION_ENTRY_POLICY,
    isStarted: Boolean(session.sessionId),
    sessionId: session.sessionId,
    hasTeacherCookie,
    waitingRoomFieldCount: getActivityWaitingRoomFieldCount(session.activityName),
    activitySupportsSolo: activitySupportsSoloMode(session.activityName),
  }
}

export async function loadPersistentSessionEntryStatus({
  activityName,
  hash,
  hasTeacherCookie,
  entryPolicyOverride,
  sessions,
}: {
  activityName: string
  hash: string
  hasTeacherCookie: boolean
  entryPolicyOverride?: PersistentSessionEntryStatus['entryPolicy']
  sessions: SessionStoreLike
}): Promise<PersistentSessionEntryStatus> {
  const context = await loadPersistentSessionEntryGatewayContext({
    activityName,
    hash,
    hasTeacherCookie,
    entryPolicyOverride,
    sessions,
  })

  return buildPersistentEntryStatus({
    activityName: context.activityName,
    hash,
    entryPolicy: context.entryPolicy,
    hasTeacherCookie: context.hasTeacherCookie,
    isStarted: context.isStarted,
    sessionId: context.sessionId,
    activitySupportsSolo: context.activitySupportsSolo,
    waitingRoomFieldCount: context.waitingRoomFieldCount,
  })
}

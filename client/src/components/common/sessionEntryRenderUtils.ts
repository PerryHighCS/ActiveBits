import type { WaitingRoomPresentationMode } from '../../../../types/waitingRoom.js'
import type { PersistentSessionEntryOutcome, PersistentSessionResolvedRole } from './persistentSessionEntryPolicyUtils'

export interface ResolveSessionJoinPreflightParams {
  sessionId?: string
  presentationMode?: WaitingRoomPresentationMode
  completedJoinPreflightSessionId?: string | null
  hasStoredParticipantContext?: boolean
  hasStoredEntryParticipantHandoff?: boolean
  allowStoredParticipantContext?: boolean
}

export function shouldRenderSessionJoinPreflight({
  sessionId,
  presentationMode,
  completedJoinPreflightSessionId,
  hasStoredParticipantContext = false,
  hasStoredEntryParticipantHandoff = false,
  allowStoredParticipantContext = false,
}: ResolveSessionJoinPreflightParams): boolean {
  if (!sessionId) {
    return false
  }

  if (presentationMode !== 'render-ui') {
    return false
  }

  if (hasStoredEntryParticipantHandoff) {
    return false
  }

  if (hasStoredParticipantContext && allowStoredParticipantContext !== true) {
    return false
  }

  return completedJoinPreflightSessionId !== sessionId
}

export function shouldAutoRedirectPersistentTeacherToManage({
  isStarted,
  sessionId,
  resolvedRole,
  entryOutcome,
  presentationMode,
}: {
  isStarted?: boolean
  sessionId?: string | null
  resolvedRole?: PersistentSessionResolvedRole
  entryOutcome?: PersistentSessionEntryOutcome
  presentationMode?: WaitingRoomPresentationMode
}): boolean {
  return isStarted === true
    && typeof sessionId === 'string'
    && sessionId.length > 0
    && resolvedRole === 'teacher'
    && entryOutcome === 'join-live'
    && presentationMode === 'pass-through'
}

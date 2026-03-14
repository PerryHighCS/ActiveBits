import type { WaitingRoomPresentationMode } from '../../../../types/waitingRoom.js'

export interface ResolveSessionJoinPreflightParams {
  sessionId?: string
  presentationMode?: WaitingRoomPresentationMode
  completedJoinPreflightSessionId?: string | null
  hasStoredParticipantContext?: boolean
  allowStoredParticipantContext?: boolean
}

export function shouldRenderSessionJoinPreflight({
  sessionId,
  presentationMode,
  completedJoinPreflightSessionId,
  hasStoredParticipantContext = false,
  allowStoredParticipantContext = false,
}: ResolveSessionJoinPreflightParams): boolean {
  if (!sessionId) {
    return false
  }

  if (presentationMode !== 'render-ui') {
    return false
  }

  if (hasStoredParticipantContext && allowStoredParticipantContext !== true) {
    return false
  }

  return completedJoinPreflightSessionId !== sessionId
}

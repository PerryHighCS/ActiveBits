import type { WaitingRoomPresentationMode } from '../../../../types/waitingRoom.js'

export interface ResolveSessionJoinPreflightParams {
  sessionId?: string
  presentationMode?: WaitingRoomPresentationMode
  completedJoinPreflightSessionId?: string | null
  hasStoredParticipantContext?: boolean
}

export function shouldRenderSessionJoinPreflight({
  sessionId,
  presentationMode,
  completedJoinPreflightSessionId,
  hasStoredParticipantContext = false,
}: ResolveSessionJoinPreflightParams): boolean {
  if (!sessionId) {
    return false
  }

  if (presentationMode !== 'render-ui') {
    return false
  }

  if (hasStoredParticipantContext) {
    return false
  }

  return completedJoinPreflightSessionId !== sessionId
}

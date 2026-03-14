import type { WaitingRoomPresentationMode } from '../../../../types/waitingRoom.js'

export interface ResolveSessionJoinPreflightParams {
  sessionId?: string
  presentationMode?: WaitingRoomPresentationMode
  completedJoinPreflightSessionId?: string | null
}

export function shouldRenderSessionJoinPreflight({
  sessionId,
  presentationMode,
  completedJoinPreflightSessionId,
}: ResolveSessionJoinPreflightParams): boolean {
  if (!sessionId) {
    return false
  }

  if (presentationMode !== 'render-ui') {
    return false
  }

  return completedJoinPreflightSessionId !== sessionId
}

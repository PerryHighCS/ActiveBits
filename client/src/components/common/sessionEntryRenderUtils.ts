export interface ResolveSessionJoinPreflightParams {
  sessionId?: string
  waitingRoomFieldCount: number
  completedJoinPreflightSessionId?: string | null
}

export function shouldRenderSessionJoinPreflight({
  sessionId,
  waitingRoomFieldCount,
  completedJoinPreflightSessionId,
}: ResolveSessionJoinPreflightParams): boolean {
  if (!sessionId) {
    return false
  }

  if (waitingRoomFieldCount <= 0) {
    return false
  }

  return completedJoinPreflightSessionId !== sessionId
}

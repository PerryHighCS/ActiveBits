import { buildPersistentTeacherManagePath } from './sessionRouterUtils'

export interface WaitingRoomTeacherSubmitPayload {
  isStarted?: boolean
  sessionId?: string | null
}

export interface ResolveWaitingRoomTeacherSubmitParams {
  payload: WaitingRoomTeacherSubmitPayload
  activityName: string
  queryString: string
  normalizedTeacherCode: string
  hasOpenSocket: boolean
}

export interface WaitingRoomTeacherSubmitResolution {
  navigateTo?: string
  closeSocket?: boolean
  sendVerifyTeacherCode?: string
  errorMessage?: string
  isSubmitting?: boolean
  clearTeacherAuthRequested?: boolean
}

export function resolveWaitingRoomTeacherSubmitResult({
  payload,
  activityName,
  queryString,
  normalizedTeacherCode,
  hasOpenSocket,
}: ResolveWaitingRoomTeacherSubmitParams): WaitingRoomTeacherSubmitResolution {
  if (payload.isStarted && typeof payload.sessionId === 'string' && payload.sessionId.length > 0) {
    return {
      navigateTo: buildPersistentTeacherManagePath(activityName, payload.sessionId, queryString),
      closeSocket: true,
    }
  }

  if (hasOpenSocket) {
    return {
      sendVerifyTeacherCode: normalizedTeacherCode,
    }
  }

  return {
    errorMessage: 'Not connected. Please refresh the page.',
    isSubmitting: false,
    clearTeacherAuthRequested: true,
  }
}

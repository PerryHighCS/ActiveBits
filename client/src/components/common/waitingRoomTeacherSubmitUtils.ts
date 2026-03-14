export interface WaitingRoomTeacherSubmitPayload {
  isStarted?: boolean
  sessionId?: string | null
}

export interface ResolveWaitingRoomTeacherSubmitParams {
  payload: WaitingRoomTeacherSubmitPayload
  activityName: string
  queryString: string
  normalizedTeacherCode: string
  isWaitingForTeacher: boolean
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
  isWaitingForTeacher,
  hasOpenSocket,
}: ResolveWaitingRoomTeacherSubmitParams): WaitingRoomTeacherSubmitResolution {
  if (payload.isStarted && typeof payload.sessionId === 'string' && payload.sessionId.length > 0) {
    return {
      navigateTo: `/manage/${activityName}/${payload.sessionId}${queryString}`,
      closeSocket: true,
    }
  }

  if (!isWaitingForTeacher) {
    return {
      errorMessage: 'Live session is unavailable right now. Please refresh and try again.',
      isSubmitting: false,
      clearTeacherAuthRequested: true,
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

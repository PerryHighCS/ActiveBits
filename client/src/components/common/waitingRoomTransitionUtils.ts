import type { WaitingRoomMessage } from './waitingRoomUtils'

export interface WaitingRoomMessageResolution {
  waiterCount?: number
  error?: string | null
  isSubmitting?: boolean
  clearTeacherAuthRequested?: boolean
  navigateTo?: string
}

export interface ResolveWaitingRoomMessageParams {
  message: WaitingRoomMessage
  teacherAuthRequested: boolean
  activityName: string
  queryString: string
}

export function resolveWaitingRoomMessageTransition({
  message,
  teacherAuthRequested,
  activityName,
  queryString,
}: ResolveWaitingRoomMessageParams): WaitingRoomMessageResolution {
  if (message.type === 'waiter-count') {
    return { waiterCount: message.count }
  }

  if (message.type === 'session-started') {
    return {
      navigateTo: teacherAuthRequested
        ? `/manage/${activityName}/${message.sessionId}${queryString}`
        : `/${message.sessionId}${queryString}`,
    }
  }

  if (message.type === 'session-ended') {
    return { navigateTo: '/session-ended' }
  }

  if (message.type === 'teacher-authenticated') {
    return {
      navigateTo: `/manage/${activityName}/${message.sessionId}${queryString}`,
    }
  }

  return {
    error: message.error,
    isSubmitting: false,
    clearTeacherAuthRequested: true,
  }
}

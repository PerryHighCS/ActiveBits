import type { WaitingRoomMessage } from './waitingRoomUtils'
import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'
import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'

export interface WaitingRoomMessageResolution {
  waiterCount?: number
  error?: string | null
  isSubmitting?: boolean
  clearTeacherAuthRequested?: boolean
  navigateTo?: string
  nextEntryOutcome?: PersistentSessionEntryOutcome
  nextStartedSessionId?: string | null
}

export interface ResolveWaitingRoomMessageParams {
  message: WaitingRoomMessage
  teacherAuthRequested: boolean
  activityName: string
  queryString: string
  currentEntryOutcome: PersistentSessionEntryOutcome
  currentEntryPolicy?: PersistentSessionEntryPolicy
}

export function resolveWaitingRoomMessageTransition({
  message,
  teacherAuthRequested,
  activityName,
  queryString,
  currentEntryOutcome,
  currentEntryPolicy,
}: ResolveWaitingRoomMessageParams): WaitingRoomMessageResolution {
  if (message.type === 'waiter-count') {
    return { waiterCount: message.count }
  }

  if (message.type === 'session-started') {
    if (!teacherAuthRequested && currentEntryPolicy && (
      currentEntryPolicy !== 'solo-only'
      && (
      currentEntryOutcome === 'continue-solo'
      || currentEntryOutcome === 'wait'
      )
    )) {
      return {
        error: null,
        isSubmitting: false,
        clearTeacherAuthRequested: true,
        nextEntryOutcome: 'join-live',
        nextStartedSessionId: message.sessionId,
      }
    }

    return {
      navigateTo: teacherAuthRequested
        ? `/manage/${activityName}/${message.sessionId}${queryString}`
        : `/${message.sessionId}${queryString}`,
    }
  }

  if (message.type === 'session-ended') {
    if (!teacherAuthRequested && currentEntryOutcome === 'join-live' && currentEntryPolicy === 'solo-allowed') {
      return {
        error: null,
        isSubmitting: false,
        clearTeacherAuthRequested: true,
        nextEntryOutcome: 'continue-solo',
        nextStartedSessionId: null,
      }
    }

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

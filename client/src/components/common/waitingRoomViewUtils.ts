import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'

export interface WaitingRoomViewModel {
  statusTitle: string
  statusDetail: string
  fieldHeading: string
  fieldDescription: string
  showWaiterCount: boolean
  showTeacherSection: boolean
  primaryActionLabel: string | null
}

export function getWaitingRoomViewModel(entryOutcome: PersistentSessionEntryOutcome): WaitingRoomViewModel {
  if (entryOutcome === 'continue-solo') {
    return {
      statusTitle: '',
      statusDetail: '',
      fieldHeading: '',
      fieldDescription: '',
      showWaiterCount: false,
      showTeacherSection: true,
      primaryActionLabel: 'Continue in Solo Mode',
    }
  }

  if (entryOutcome === 'join-live') {
    return {
      statusTitle: '',
      statusDetail: '',
      fieldHeading: '',
      fieldDescription: '',
      showWaiterCount: false,
      showTeacherSection: true,
      primaryActionLabel: 'Join Session',
    }
  }

  if (entryOutcome === 'solo-unavailable') {
    return {
      statusTitle: 'Solo mode is not available',
      statusDetail: 'This activity does not support solo mode. Ask your teacher for a join code.',
      fieldHeading: '',
      fieldDescription: '',
      showWaiterCount: false,
      showTeacherSection: false,
      primaryActionLabel: null,
    }
  }

  return {
    statusTitle: 'Waiting for teacher to start the activity',
    statusDetail: 'You can complete any required details while you wait.',
    fieldHeading: 'Before you join',
    fieldDescription: 'Complete these details while you wait for the activity to begin.',
    showWaiterCount: true,
    showTeacherSection: true,
    primaryActionLabel: null,
  }
}

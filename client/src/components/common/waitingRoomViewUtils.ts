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
      statusTitle: 'Solo mode is available',
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
      statusTitle: 'Session is ready to join',
      statusDetail: '',
      fieldHeading: '',
      fieldDescription: '',
      showWaiterCount: false,
      showTeacherSection: true,
      primaryActionLabel: 'Join Session',
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

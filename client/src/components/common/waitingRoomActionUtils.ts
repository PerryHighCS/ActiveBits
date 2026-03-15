import type { WaitingRoomFieldConfig } from '../../../../types/waitingRoom.js'
import type { WaitingRoomFieldErrorMap } from './waitingRoomFormUtils'
import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'

export interface WaitingRoomPrimaryActionResolution {
  touchedFields: Record<string, boolean>
  errorMessage: string | null
}

export function buildTouchedWaitingRoomFields(
  waitingRoomFields: readonly WaitingRoomFieldConfig[],
): Record<string, boolean> {
  return waitingRoomFields.reduce<Record<string, boolean>>((fields, field) => {
    fields[field.id] = true
    return fields
  }, {})
}

export function resolveWaitingRoomPrimaryAction({
  waitingRoomFields,
  waitingRoomErrors,
  entryOutcome,
  startedSessionId,
}: {
  waitingRoomFields: readonly WaitingRoomFieldConfig[]
  waitingRoomErrors: WaitingRoomFieldErrorMap
  entryOutcome: PersistentSessionEntryOutcome
  startedSessionId?: string
}): WaitingRoomPrimaryActionResolution {
  const touchedFields = buildTouchedWaitingRoomFields(waitingRoomFields)

  if (Object.keys(waitingRoomErrors).length > 0) {
    return {
      touchedFields,
      errorMessage: entryOutcome === 'join-live'
        ? 'Please complete the required details before joining.'
        : 'Please complete the required details before continuing.',
    }
  }

  if (entryOutcome === 'solo-unavailable') {
    return {
      touchedFields,
      errorMessage: 'Solo mode is not available for this activity.',
    }
  }

  if (entryOutcome === 'join-live' && !startedSessionId) {
    return {
      touchedFields,
      errorMessage: 'Live session is unavailable right now. Please refresh and try again.',
    }
  }

  return {
    touchedFields,
    errorMessage: null,
  }
}

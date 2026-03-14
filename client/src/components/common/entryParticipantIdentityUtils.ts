import {
  consumeResolvedEntryParticipantValues,
  getEntryParticipantDisplayName,
  getEntryParticipantParticipantId,
  type EntryParticipantFetchLike,
  type EntryParticipantLookupParams,
  type EntryParticipantStorageLike,
} from './entryParticipantStorage'

export interface ResolvedEntryParticipantIdentity {
  studentName: string
  studentId: string | null
  nameSubmitted: boolean
}

interface ResolveInitialEntryParticipantIdentityParams extends EntryParticipantLookupParams {
  localStorage: EntryParticipantStorageLike | null
  sessionStorage: EntryParticipantStorageLike | null
  soloDisplayName?: string
}

function getStoredString(storage: EntryParticipantStorageLike, key: string): string | null {
  const value = storage.getItem(key)
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function persistSessionParticipantIdentity(
  storage: EntryParticipantStorageLike,
  sessionId: string,
  studentName: string,
  studentId: string | null,
): void {
  storage.setItem(`student-name-${sessionId}`, studentName)
  if (studentId) {
    storage.setItem(`student-id-${sessionId}`, studentId)
  }
}

export async function resolveInitialEntryParticipantIdentity(
  {
    activityName,
    sessionId,
    isSoloSession,
    localStorage,
    sessionStorage,
    soloDisplayName = 'Solo Student',
  }: ResolveInitialEntryParticipantIdentityParams,
  fetchImpl?: EntryParticipantFetchLike | null,
): Promise<ResolvedEntryParticipantIdentity> {
  const preflightValues = sessionStorage
    ? await consumeResolvedEntryParticipantValues(sessionStorage, {
      activityName,
      sessionId,
      isSoloSession,
    }, fetchImpl)
    : null
  const preflightDisplayName = getEntryParticipantDisplayName(preflightValues)
  const preflightParticipantId = getEntryParticipantParticipantId(preflightValues)

  if (isSoloSession) {
    return {
      studentName: preflightDisplayName ?? soloDisplayName,
      studentId: preflightParticipantId,
      nameSubmitted: true,
    }
  }

  if (!sessionId) {
    return {
      studentName: '',
      studentId: null,
      nameSubmitted: false,
    }
  }

  if (localStorage) {
    const savedName = getStoredString(localStorage, `student-name-${sessionId}`)
    if (savedName) {
      return {
        studentName: savedName,
        studentId: getStoredString(localStorage, `student-id-${sessionId}`),
        nameSubmitted: true,
      }
    }
  }

  if (preflightDisplayName) {
    if (localStorage) {
      persistSessionParticipantIdentity(localStorage, sessionId, preflightDisplayName, preflightParticipantId)
    }

    return {
      studentName: preflightDisplayName,
      studentId: preflightParticipantId,
      nameSubmitted: true,
    }
  }

  return {
    studentName: '',
    studentId: null,
    nameSubmitted: false,
  }
}

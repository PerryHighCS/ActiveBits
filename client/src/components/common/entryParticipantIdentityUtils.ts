import {
  consumeResolvedEntryParticipantValues,
  getEntryParticipantDisplayName,
  getEntryParticipantParticipantId,
  type EntryParticipantFetchLike,
  type EntryParticipantLookupParams,
  type EntryParticipantStorageLike,
} from './entryParticipantStorage'
import {
  persistSessionParticipantContext,
  readSessionParticipantContext,
} from './sessionParticipantContext'

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

type StorageWarnHandler = (message: string, error: unknown) => void

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
  onWarn: StorageWarnHandler = console.warn,
): void {
  persistSessionParticipantContext(storage, sessionId, {
    studentName,
    studentId,
  }, onWarn)

  try {
    storage.setItem(`student-name-${sessionId}`, studentName)
  } catch (error) {
    onWarn('[EntryParticipantIdentity] Failed to persist student name:', error)
  }

  if (studentId) {
    try {
      storage.setItem(`student-id-${sessionId}`, studentId)
    } catch (error) {
      onWarn('[EntryParticipantIdentity] Failed to persist student id:', error)
    }
  }
}

export function readStoredSessionParticipantIdentity(
  storage: EntryParticipantStorageLike,
  sessionId: string,
): ResolvedEntryParticipantIdentity | null {
  const sharedContext = readSessionParticipantContext(storage, sessionId)
  if (sharedContext?.studentName || sharedContext?.studentId) {
    return {
      studentName: sharedContext.studentName ?? '',
      studentId: sharedContext.studentId,
      nameSubmitted: true,
    }
  }

  const savedName = getStoredString(storage, `student-name-${sessionId}`)
  const savedId = getStoredString(storage, `student-id-${sessionId}`)
  if (savedName || savedId) {
    persistSessionParticipantContext(storage, sessionId, {
      studentName: savedName,
      studentId: savedId,
    })
    return {
      studentName: savedName ?? '',
      studentId: savedId,
      nameSubmitted: true,
    }
  }

  return null
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
    const storedIdentity = readStoredSessionParticipantIdentity(localStorage, sessionId)
    if (storedIdentity) {
      return storedIdentity
    }
  }

  if (preflightDisplayName || preflightParticipantId) {
    if (localStorage) {
      persistSessionParticipantContext(localStorage, sessionId, {
        studentName: preflightDisplayName,
        studentId: preflightParticipantId,
      })
    }

    return {
      studentName: preflightDisplayName ?? '',
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

export interface SyncDeckAcceptedEntryIdentity {
  displayName: string | null
  participantId: string | null
}

export interface SyncDeckStoredIdentity {
  studentName: string
  studentId: string
}

export interface SyncDeckResolvedIdentity {
  studentName: string
  studentId: string
  needsWaitingRoomRestart: boolean
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveSyncDeckStudentIdentity(
  stored: SyncDeckStoredIdentity,
  accepted: SyncDeckAcceptedEntryIdentity,
): SyncDeckResolvedIdentity {
  const storedName = normalizeString(stored.studentName)
  const storedId = normalizeString(stored.studentId)
  if (storedName && storedId) {
    return {
      studentName: storedName,
      studentId: storedId,
      needsWaitingRoomRestart: false,
    }
  }

  const acceptedName = normalizeString(accepted.displayName)
  const acceptedId = normalizeString(accepted.participantId)
  if (acceptedName && acceptedId) {
    return {
      studentName: acceptedName,
      studentId: acceptedId,
      needsWaitingRoomRestart: false,
    }
  }

  return {
    studentName: '',
    studentId: '',
    needsWaitingRoomRestart: true,
  }
}


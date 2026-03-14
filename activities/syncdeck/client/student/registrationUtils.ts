export interface SyncDeckAcceptedEntryIdentity {
  displayName: string | null
  participantId: string | null
}

export interface SyncDeckStoredIdentity {
  studentName: string
  studentId: string
}

export interface SyncDeckInitialRegistrationState {
  studentNameInput: string
  registeredStudentName: string
  registeredStudentId: string
  pendingAcceptedParticipantId: string
}

export interface SyncDeckAutoRegistrationState {
  isRegisteringStudent: boolean
  pendingAcceptedParticipantId: string
  registeredStudentId: string
  registeredStudentName: string
  studentNameInput: string
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveSyncDeckInitialRegistrationState(
  stored: SyncDeckStoredIdentity,
  accepted: SyncDeckAcceptedEntryIdentity,
): SyncDeckInitialRegistrationState {
  const storedName = normalizeString(stored.studentName)
  const storedId = normalizeString(stored.studentId)
  if (storedName && storedId) {
    return {
      studentNameInput: storedName,
      registeredStudentName: storedName,
      registeredStudentId: storedId,
      pendingAcceptedParticipantId: '',
    }
  }

  return {
    studentNameInput: normalizeString(accepted.displayName),
    registeredStudentName: '',
    registeredStudentId: '',
    pendingAcceptedParticipantId: normalizeString(accepted.participantId),
  }
}

export function buildSyncDeckRegistrationRequest(name: string, participantId: string): {
  name: string
  participantId?: string
} {
  const normalizedName = normalizeString(name).slice(0, 80)
  const normalizedParticipantId = normalizeString(participantId)

  return {
    name: normalizedName,
    ...(normalizedParticipantId ? { participantId: normalizedParticipantId } : {}),
  }
}

export function shouldAutoRegisterSyncDeckStudent(state: SyncDeckAutoRegistrationState): boolean {
  if (state.isRegisteringStudent) {
    return false
  }

  return (
    normalizeString(state.pendingAcceptedParticipantId).length > 0
    && normalizeString(state.studentNameInput).length > 0
    && normalizeString(state.registeredStudentName).length === 0
    && normalizeString(state.registeredStudentId).length === 0
  )
}

export function shouldShowSyncDeckAutoRegistrationGate(state: SyncDeckAutoRegistrationState): boolean {
  return (
    normalizeString(state.pendingAcceptedParticipantId).length > 0
    && normalizeString(state.studentNameInput).length > 0
    && normalizeString(state.registeredStudentName).length === 0
    && normalizeString(state.registeredStudentId).length === 0
  )
}

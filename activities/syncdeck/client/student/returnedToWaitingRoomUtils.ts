import { buildSessionParticipantContextStorageKey } from '@src/components/common/sessionParticipantContext'

type RemovableStorage = Pick<Storage, 'removeItem'>

/**
 * Removes every stored SyncDeck student identity for the session, in both
 * sessionStorage and localStorage, so a later load cannot resume a revoked or
 * rejected student ID.
 */
export function clearSyncDeckStoredStudentIdentity(sessionId: string, storage: RemovableStorage, sessionStorage: RemovableStorage): void {
  sessionStorage.removeItem(`syncdeck_student_name_${sessionId}`)
  sessionStorage.removeItem(`syncdeck_student_id_${sessionId}`)
  sessionStorage.removeItem(buildSessionParticipantContextStorageKey(sessionId))
  storage.removeItem(`syncdeck_student_name_${sessionId}`)
  storage.removeItem(`syncdeck_student_id_${sessionId}`)
  storage.removeItem(`student-name-${sessionId}`)
  storage.removeItem(`student-id-${sessionId}`)
  storage.removeItem(buildSessionParticipantContextStorageKey(sessionId))
}

export function handleReturnedToWaitingRoom(params: { participantId: unknown; registeredStudentId: string; sessionId: string; storage: Storage; sessionStorage: Storage; redirect: (url: string) => void }): boolean {
  if (params.participantId !== params.registeredStudentId) return false
  const { sessionId } = params
  clearSyncDeckStoredStudentIdentity(sessionId, params.storage, params.sessionStorage)
  params.redirect(`/${encodeURIComponent(sessionId)}`)
  return true
}

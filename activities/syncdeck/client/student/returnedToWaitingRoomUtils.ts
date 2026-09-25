import { buildSessionParticipantContextStorageKey } from '@src/components/common/sessionParticipantContext'

type RemovableStorage = Pick<Storage, 'removeItem'>

/**
 * Returns `window.localStorage` or `window.sessionStorage`, or null when the
 * browser blocks storage (the getter itself can throw a SecurityError).
 */
export function readWindowStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[kind]
  } catch {
    return null
  }
}

/**
 * Removes every stored SyncDeck student identity for the session, in both
 * sessionStorage and localStorage, so a later load cannot resume a revoked or
 * rejected student ID. Best effort: a missing storage or a failing key is
 * skipped so the caller's rejoin and recovery still run.
 */
export function clearSyncDeckStoredStudentIdentity(sessionId: string, storage: RemovableStorage | null, sessionStorage: RemovableStorage | null): void {
  const remove = (target: RemovableStorage | null, key: string) => {
    if (!target) return
    try {
      target.removeItem(key)
    } catch (error) {
      console.warn('[SyncDeck][StudentIdentity] Failed to clear stored identity:', error)
    }
  }
  remove(sessionStorage, `syncdeck_student_name_${sessionId}`)
  remove(sessionStorage, `syncdeck_student_id_${sessionId}`)
  remove(sessionStorage, buildSessionParticipantContextStorageKey(sessionId))
  remove(storage, `syncdeck_student_name_${sessionId}`)
  remove(storage, `syncdeck_student_id_${sessionId}`)
  remove(storage, `student-name-${sessionId}`)
  remove(storage, `student-id-${sessionId}`)
  remove(storage, buildSessionParticipantContextStorageKey(sessionId))
}

export function handleReturnedToWaitingRoom(params: { participantId: unknown; registeredStudentId: string; sessionId: string; storage: Storage; sessionStorage: Storage; redirect: (url: string) => void }): boolean {
  if (params.participantId !== params.registeredStudentId) return false
  const { sessionId } = params
  clearSyncDeckStoredStudentIdentity(sessionId, params.storage, params.sessionStorage)
  params.redirect(`/${encodeURIComponent(sessionId)}`)
  return true
}

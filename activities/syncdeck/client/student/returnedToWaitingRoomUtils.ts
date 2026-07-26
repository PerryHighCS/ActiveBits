import { buildSessionParticipantContextStorageKey } from '@src/components/common/sessionParticipantContext'

export function handleReturnedToWaitingRoom(params: { participantId: unknown; registeredStudentId: string; sessionId: string; storage: Storage; redirect: (url: string) => void }): boolean {
  if (params.participantId !== params.registeredStudentId) return false
  const { sessionId, storage } = params
  storage.removeItem(`syncdeck_student_name_${sessionId}`)
  storage.removeItem(`syncdeck_student_id_${sessionId}`)
  storage.removeItem(`student-name-${sessionId}`)
  storage.removeItem(`student-id-${sessionId}`)
  storage.removeItem(buildSessionParticipantContextStorageKey(sessionId))
  params.redirect(`/${encodeURIComponent(sessionId)}`)
  return true
}

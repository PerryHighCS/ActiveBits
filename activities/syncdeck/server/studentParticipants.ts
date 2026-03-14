import { generateParticipantId } from 'activebits-server/core/participantIds.js'
import { connectSessionParticipant, type SessionParticipantIdentity } from 'activebits-server/core/sessionParticipants.js'

export interface SyncDeckStudentParticipant {
  studentId: string
  name: string
  joinedAt: number
  lastSeenAt: number
  lastIndices: { h: number; v: number; f: number } | null
  lastStudentStateAt: number | null
}

interface SyncDeckParticipantAdapter extends SessionParticipantIdentity {
  source: SyncDeckStudentParticipant
}

function toAdapter(student: SyncDeckStudentParticipant): SyncDeckParticipantAdapter {
  return {
    id: student.studentId,
    name: student.name,
    lastSeen: student.lastSeenAt,
    source: student,
  }
}

function syncAdapterToSource(adapter: SyncDeckParticipantAdapter): void {
  adapter.source.studentId = adapter.id ?? adapter.source.studentId
  adapter.source.name = adapter.name
  adapter.source.lastSeenAt = typeof adapter.lastSeen === 'number' ? adapter.lastSeen : adapter.source.lastSeenAt
}

function createSyncDeckStudent(
  participantId: string,
  participantName: string,
  now: number,
): SyncDeckStudentParticipant {
  return {
    studentId: participantId,
    name: participantName,
    joinedAt: now,
    lastSeenAt: now,
    lastIndices: null,
    lastStudentStateAt: null,
  }
}

export function registerSyncDeckStudent(
  students: SyncDeckStudentParticipant[],
  participantName: string,
  now = Date.now(),
  participantId: string | null = null,
): { participantId: string; student: SyncDeckStudentParticipant; isNew: boolean } {
  const normalizedParticipantId = typeof participantId === 'string' ? participantId.trim() : ''
  if (normalizedParticipantId) {
    const existing = students.find((student) => student.studentId === normalizedParticipantId)
    if (existing) {
      existing.name = participantName
      existing.lastSeenAt = now
      return {
        participantId: existing.studentId,
        student: existing,
        isNew: false,
      }
    }
  }

  const resolvedParticipantId = normalizedParticipantId || generateParticipantId()
  const student = createSyncDeckStudent(resolvedParticipantId, participantName, now)
  students.push(student)
  return { participantId: resolvedParticipantId, student, isNew: true }
}

export function connectSyncDeckStudent(
  students: SyncDeckStudentParticipant[],
  participantId: string | null,
  participantName: string,
  now = Date.now(),
): { participantId: string; student: SyncDeckStudentParticipant; isNew: boolean } | null {
  if (!participantId) {
    return null
  }

  if (!students.some((student) => student.studentId === participantId)) {
    return null
  }

  const adapters = students.map(toAdapter)
  const result = connectSessionParticipant({
    participants: adapters,
    participantId,
    participantName,
    now,
    createParticipant: (resolvedParticipantId, resolvedParticipantName, createdAt) =>
      toAdapter(createSyncDeckStudent(resolvedParticipantId, resolvedParticipantName, createdAt)),
    generateParticipantId,
  })

  result.participant.name = participantName
  syncAdapterToSource(result.participant)
  if (result.isNew) {
    students.push(result.participant.source)
  }

  return {
    participantId: result.participantId,
    student: result.participant.source,
    isNew: result.isNew,
  }
}

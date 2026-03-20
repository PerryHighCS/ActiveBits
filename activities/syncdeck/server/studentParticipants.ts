import { generateParticipantId } from 'activebits-server/core/participantIds.js'
import { connectAcceptedSessionParticipant } from 'activebits-server/core/acceptedSessionParticipants.js'
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

interface SyncDeckSessionLike {
  data: {
    students: SyncDeckStudentParticipant[]
  }
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

export function connectSyncDeckStudent(
  session: SyncDeckSessionLike,
  participantId: string | null,
  now = Date.now(),
): { participantId: string; student: SyncDeckStudentParticipant; isNew: boolean } | null {
  if (!participantId) {
    return null
  }

  const students = session.data.students
  const existingStudent = students.find((student) => student.studentId === participantId)
  if (existingStudent) {
    const adapters = students.map(toAdapter)
    const result = connectSessionParticipant({
      participants: adapters,
      participantId,
      participantName: existingStudent.name,
      now,
      createParticipant: (resolvedParticipantId, resolvedParticipantName, createdAt) =>
        toAdapter(createSyncDeckStudent(resolvedParticipantId, resolvedParticipantName, createdAt)),
      generateParticipantId,
    })

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

  const adapters = students.map(toAdapter)
  const result = connectAcceptedSessionParticipant({
    session,
    participants: adapters,
    participantId,
    participantName: null,
    now,
    createParticipant: (resolvedParticipantId, resolvedParticipantName, createdAt) =>
      toAdapter(createSyncDeckStudent(resolvedParticipantId, resolvedParticipantName, createdAt)),
    generateParticipantId,
  })
  if (!result) {
    return null
  }

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

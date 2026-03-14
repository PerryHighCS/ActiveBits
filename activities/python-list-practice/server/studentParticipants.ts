import { connectAcceptedSessionParticipant } from 'activebits-server/core/acceptedSessionParticipants.js'
import { generateParticipantId } from 'activebits-server/core/participantIds.js'
import {
  disconnectSessionParticipant,
  updateSessionParticipant,
} from 'activebits-server/core/sessionParticipants.js'
import type { PythonListPracticeStats, PythonListPracticeStudent } from '../pythonListPracticeTypes.js'

interface PythonListPracticeSessionLike {
  data: {
    students: PythonListPracticeStudent[]
  }
}

const defaultStats: PythonListPracticeStats = {
  total: 0,
  correct: 0,
  streak: 0,
  longestStreak: 0,
}

function createPythonListPracticeStudent(
  participantId: string,
  participantName: string,
  now: number,
  stats: PythonListPracticeStats = defaultStats,
): PythonListPracticeStudent {
  return {
    id: participantId,
    name: participantName,
    stats,
    connected: true,
    lastSeen: now,
  }
}

export function normalizePythonListPracticeStudent(
  value: {
    id?: string | null
    name: string
    stats: PythonListPracticeStats
    connected: boolean
    lastSeen?: number
  },
  now = Date.now(),
): PythonListPracticeStudent {
  return {
    id: typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : generateParticipantId(),
    name: value.name,
    stats: value.stats,
    connected: value.connected,
    lastSeen: typeof value.lastSeen === 'number' ? value.lastSeen : now,
  }
}

export function connectPythonListPracticeStudent(
  session: PythonListPracticeSessionLike,
  participantId: string | null,
  participantName: string | null,
  now = Date.now(),
): { participantId: string; participantName: string } | null {
  const result = connectAcceptedSessionParticipant({
    session,
    participants: session.data.students,
    participantId,
    participantName,
    now,
    allowLegacyUnnamedMatch: true,
    createParticipant: (resolvedParticipantId, resolvedParticipantName, createdAt) =>
      createPythonListPracticeStudent(resolvedParticipantId, resolvedParticipantName, createdAt),
    generateParticipantId,
  })

  if (!result) {
    return null
  }

  return {
    participantId: result.participantId,
    participantName: result.participantName,
  }
}

export function updatePythonListPracticeStudentStats(
  students: PythonListPracticeStudent[],
  {
    participantId,
    participantName,
    stats,
    now = Date.now(),
  }: {
    participantId: string | null
    participantName: string | null
    stats: PythonListPracticeStats
    now?: number
  },
): PythonListPracticeStudent | null {
  const existing = updateSessionParticipant({
    participants: students,
    participantId,
    participantName,
    allowLegacyUnnamedMatch: true,
    now,
    update: (participant) => {
      participant.stats = stats
      participant.connected = true
    },
  })

  if (existing) {
    return existing
  }

  if (!participantName) {
    return null
  }

  const created = createPythonListPracticeStudent(participantId ?? generateParticipantId(), participantName, now, stats)
  students.push(created)
  return created
}

export function disconnectPythonListPracticeStudent(
  students: PythonListPracticeStudent[],
  participantId: string | null,
  participantName: string | null,
  now = Date.now(),
): PythonListPracticeStudent | undefined {
  return disconnectSessionParticipant({
    participants: students,
    participantId,
    participantName,
    allowLegacyUnnamedMatch: true,
    now,
  })
}

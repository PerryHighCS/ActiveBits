import {
  connectSessionParticipant,
  type ConnectSessionParticipantParams,
  type ConnectSessionParticipantResult,
  findSessionParticipant,
  type SessionParticipantIdentity,
} from './sessionParticipants.js'
import type { AcceptedEntryParticipantSessionLike } from './acceptedEntryParticipants.js'
import { resolveAcceptedEntryParticipantName } from './acceptedEntryParticipants.js'

export interface ConnectAcceptedSessionParticipantParams<TParticipant extends SessionParticipantIdentity>
  extends Omit<ConnectSessionParticipantParams<TParticipant>, 'participantName'> {
  session: AcceptedEntryParticipantSessionLike
  participantName: string | null
}

export interface ConnectAcceptedSessionParticipantResult<TParticipant extends SessionParticipantIdentity>
  extends ConnectSessionParticipantResult<TParticipant> {
  participantName: string
}

export function connectAcceptedSessionParticipant<TParticipant extends SessionParticipantIdentity>({
  session,
  participants,
  participantId,
  participantName,
  now,
  allowLegacyUnnamedMatch,
  createParticipant,
  generateParticipantId,
}: ConnectAcceptedSessionParticipantParams<TParticipant>): ConnectAcceptedSessionParticipantResult<TParticipant> | null {
  const resolvedParticipantName = resolveAcceptedEntryParticipantName(
    session,
    participantId,
    participantName,
  )
  if (!resolvedParticipantName) {
    return null
  }

  const normalizedParticipantId = typeof participantId === 'string' ? participantId.trim() : ''
  if (normalizedParticipantId) {
    const existingParticipant = findSessionParticipant({
      participants,
      participantId: normalizedParticipantId,
      participantName: null,
      allowLegacyUnnamedMatch,
    })
    if (!existingParticipant) {
      const participant = createParticipant(normalizedParticipantId, resolvedParticipantName, now ?? Date.now())
      participants.push(participant)
      return {
        participant,
        participantId: normalizedParticipantId,
        participantName: resolvedParticipantName,
        isNew: true,
      }
    }
  }

  const result = connectSessionParticipant({
    participants,
    participantId,
    participantName: resolvedParticipantName,
    now,
    allowLegacyUnnamedMatch,
    createParticipant,
    generateParticipantId,
  })

  return {
    ...result,
    participantName: resolvedParticipantName,
  }
}

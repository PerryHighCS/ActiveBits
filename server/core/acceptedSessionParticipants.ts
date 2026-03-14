import type { SessionRecord } from './sessions.js'
import {
  connectSessionParticipant,
  type ConnectSessionParticipantParams,
  type ConnectSessionParticipantResult,
  type SessionParticipantIdentity,
} from './sessionParticipants.js'
import { resolveAcceptedEntryParticipantName } from './acceptedEntryParticipants.js'

export interface ConnectAcceptedSessionParticipantParams<TParticipant extends SessionParticipantIdentity>
  extends Omit<ConnectSessionParticipantParams<TParticipant>, 'participantName'> {
  session: SessionRecord
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

export interface SessionParticipantIdentity {
  id?: string
  name: string
  connected?: boolean
  lastSeen?: number
}

export interface ConnectSessionParticipantParams<TParticipant extends SessionParticipantIdentity> {
  participants: TParticipant[]
  participantId: string | null
  participantName: string
  now?: number
  allowLegacyUnnamedMatch?: boolean
  createParticipant: (participantId: string, participantName: string, now: number) => TParticipant
  generateParticipantId: () => string
}

export interface ConnectSessionParticipantResult<TParticipant extends SessionParticipantIdentity> {
  participant: TParticipant
  participantId: string
  isNew: boolean
}

export function connectSessionParticipant<TParticipant extends SessionParticipantIdentity>({
  participants,
  participantId,
  participantName,
  now = Date.now(),
  allowLegacyUnnamedMatch = false,
  createParticipant,
  generateParticipantId,
}: ConnectSessionParticipantParams<TParticipant>): ConnectSessionParticipantResult<TParticipant> {
  const existingParticipant = participantId
    ? participants.find((participant) => participant.id === participantId)
    : participants.find((participant) =>
        participant.name === participantName && (!allowLegacyUnnamedMatch || participant.id == null || participant.id === ''),
      )

  if (existingParticipant) {
    existingParticipant.connected = true
    existingParticipant.lastSeen = now

    const resolvedParticipantId = typeof existingParticipant.id === 'string' && existingParticipant.id.length > 0
      ? existingParticipant.id
      : generateParticipantId()

    if (existingParticipant.id !== resolvedParticipantId) {
      existingParticipant.id = resolvedParticipantId
    }

    return {
      participant: existingParticipant,
      participantId: resolvedParticipantId,
      isNew: false,
    }
  }

  const nextParticipantId = generateParticipantId()
  const nextParticipant = createParticipant(nextParticipantId, participantName, now)
  participants.push(nextParticipant)

  return {
    participant: nextParticipant,
    participantId: nextParticipantId,
    isNew: true,
  }
}

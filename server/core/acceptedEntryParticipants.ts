import type { EntryParticipantValues } from './entryParticipants.js'
import { randomBytes } from 'node:crypto'

export interface AcceptedEntryParticipantRecord {
  participantId: string
  displayName: string | null
  acceptedAt: number
}

interface AcceptedEntryParticipantContainer {
  acceptedEntryParticipants?: Record<string, AcceptedEntryParticipantRecord>
  participantAuthTokens?: Record<string, string>
}

export interface AcceptedEntryParticipantSessionLike {
  data: unknown
}

const MAX_ACCEPTED_ENTRY_PARTICIPANTS = 100
const MAX_PARTICIPANT_AUTH_TOKENS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function getAcceptedEntryParticipantContainer(session: AcceptedEntryParticipantSessionLike): AcceptedEntryParticipantContainer {
  if (!isRecord(session.data)) {
    session.data = {}
  }

  const data = session.data as Record<string, unknown>
  const current = data.acceptedEntryParticipants
  if (!isRecord(current)) {
    data.acceptedEntryParticipants = {}
  }

  return data as AcceptedEntryParticipantContainer
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function acceptEntryParticipant(
  session: AcceptedEntryParticipantSessionLike,
  values: EntryParticipantValues,
  now = Date.now(),
): AcceptedEntryParticipantRecord | null {
  const participantId = typeof values.participantId === 'string' ? values.participantId.trim() : ''
  if (!participantId) {
    return null
  }

  const record: AcceptedEntryParticipantRecord = {
    participantId,
    displayName: normalizeDisplayName(values.displayName),
    acceptedAt: now,
  }

  const container = getAcceptedEntryParticipantContainer(session)
  container.acceptedEntryParticipants ??= {}
  container.acceptedEntryParticipants[participantId] = record

  const acceptedEntries = Object.entries(container.acceptedEntryParticipants)
  if (acceptedEntries.length > MAX_ACCEPTED_ENTRY_PARTICIPANTS) {
    const overflowCount = acceptedEntries.length - MAX_ACCEPTED_ENTRY_PARTICIPANTS
    const tokensToPrune = acceptedEntries
      .sort(([, left], [, right]) => left.acceptedAt - right.acceptedAt)
      .slice(0, overflowCount)

    for (const [id] of tokensToPrune) {
      delete container.acceptedEntryParticipants[id]
    }
  }

  return record
}

export function findAcceptedEntryParticipant(
  session: AcceptedEntryParticipantSessionLike,
  participantId: string | null,
): AcceptedEntryParticipantRecord | null {
  const normalizedParticipantId = typeof participantId === 'string' ? participantId.trim() : ''
  if (!normalizedParticipantId || !isRecord(session.data)) {
    return null
  }

  const container = session.data as AcceptedEntryParticipantContainer
  return container.acceptedEntryParticipants?.[normalizedParticipantId] ?? null
}

export function getSessionParticipantCookieName(sessionId: string): string {
  return `activebits_participant_${Buffer.from(sessionId, 'utf8').toString('base64url')}`
}

/** Issues an opaque, httpOnly-cookie token for an already accepted participant. */
export function issueAcceptedEntryParticipantToken(
  session: AcceptedEntryParticipantSessionLike,
  participantId: string,
): string | null {
  if (!findAcceptedEntryParticipant(session, participantId)) return null
  const container = getAcceptedEntryParticipantContainer(session)
  container.participantAuthTokens ??= Object.create(null) as Record<string, string>
  for (const [existingToken, ownerId] of Object.entries(container.participantAuthTokens)) {
    if (ownerId === participantId) delete container.participantAuthTokens[existingToken]
  }
  const token = randomBytes(24).toString('base64url')
  container.participantAuthTokens[token] = participantId
  const tokenEntries = Object.entries(container.participantAuthTokens)
  if (tokenEntries.length > MAX_PARTICIPANT_AUTH_TOKENS) {
    for (const [expiredToken] of tokenEntries.slice(0, tokenEntries.length - MAX_PARTICIPANT_AUTH_TOKENS)) {
      delete container.participantAuthTokens[expiredToken]
    }
  }
  return token
}

export function resolveAcceptedEntryParticipantToken(
  session: AcceptedEntryParticipantSessionLike,
  token: unknown,
): AcceptedEntryParticipantRecord | null {
  if (typeof token !== 'string' || !isRecord(session.data)) return null
  const participantAuthTokens = (session.data as AcceptedEntryParticipantContainer).participantAuthTokens
  const participantId = isRecord(participantAuthTokens) && Object.hasOwn(participantAuthTokens, token)
    ? participantAuthTokens[token]
    : null
  return findAcceptedEntryParticipant(session, typeof participantId === 'string' ? participantId : null)
}

/** Revokes a participant's current accepted entry and every token issued for it. */
export function revokeAcceptedEntryParticipant(
  session: AcceptedEntryParticipantSessionLike,
  participantId: string | null,
): boolean {
  const normalizedParticipantId = typeof participantId === 'string' ? participantId.trim() : ''
  if (!normalizedParticipantId || !isRecord(session.data)) return false

  const container = session.data as AcceptedEntryParticipantContainer
  if (!container.acceptedEntryParticipants || !Object.hasOwn(container.acceptedEntryParticipants, normalizedParticipantId)) {
    return false
  }

  delete container.acceptedEntryParticipants[normalizedParticipantId]
  if (isRecord(container.participantAuthTokens)) {
    for (const [token, ownerId] of Object.entries(container.participantAuthTokens)) {
      if (ownerId === normalizedParticipantId) delete container.participantAuthTokens[token]
    }
  }
  return true
}

export function resolveAcceptedEntryParticipantName(
  session: AcceptedEntryParticipantSessionLike,
  participantId: string | null,
  fallbackName: string | null,
): string | null {
  const normalizedFallback = normalizeDisplayName(fallbackName)
  if (normalizedFallback) {
    return normalizedFallback
  }

  return findAcceptedEntryParticipant(session, participantId)?.displayName ?? null
}

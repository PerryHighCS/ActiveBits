import type { EntryParticipantValues } from './entryParticipants.js'

export interface AcceptedEntryParticipantRecord {
  participantId: string
  displayName: string | null
  acceptedAt: number
}

interface AcceptedEntryParticipantContainer {
  acceptedEntryParticipants?: Record<string, AcceptedEntryParticipantRecord>
}

export interface AcceptedEntryParticipantSessionLike {
  data: unknown
}

const MAX_ACCEPTED_ENTRY_PARTICIPANTS = 100

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

import type { SessionRecord } from './sessions.js'
import {
  consumeEntryParticipant,
  normalizeEntryParticipantValues,
  storeEntryParticipant,
  type EntryParticipantValues,
} from './entryParticipants.js'

export type SessionEntryParticipantValues = EntryParticipantValues

interface SessionEntryParticipantContainer {
  entryParticipants?: Record<string, SessionEntryParticipantValues>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export { normalizeEntryParticipantValues as normalizeSessionEntryParticipantValues }

function getSessionEntryParticipantContainer(session: SessionRecord): SessionEntryParticipantContainer {
  if (!isRecord(session.data)) {
    session.data = {}
  }

  const data = session.data as Record<string, unknown>
  const current = data.entryParticipants
  if (!isRecord(current)) {
    data.entryParticipants = {}
  }

  return data as SessionEntryParticipantContainer
}

export function storeSessionEntryParticipant(
  session: SessionRecord,
  values: unknown,
): { token: string; values: SessionEntryParticipantValues } {
  return storeEntryParticipant(getSessionEntryParticipantContainer(session), values)
}

export function consumeSessionEntryParticipant(
  session: SessionRecord,
  token: string,
): SessionEntryParticipantValues | null {
  return consumeEntryParticipant(getSessionEntryParticipantContainer(session), token)
}

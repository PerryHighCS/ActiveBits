import type { SessionRecord } from './sessions.js'
import {
  consumeEntryParticipant,
  normalizeEntryParticipantValues,
  storeEntryParticipant,
  type EntryParticipantValues,
} from './entryParticipants.js'

export type SessionEntryParticipantValues = EntryParticipantValues

const MAX_SESSION_ENTRY_PARTICIPANTS = 100
const MAX_SESSION_ENTRY_PARTICIPANT_VALUES_BYTES = 8 * 1024

export class SessionEntryParticipantStoreError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'SessionEntryParticipantStoreError'
    this.statusCode = statusCode
  }
}

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

function pruneSessionEntryParticipants(
  container: SessionEntryParticipantContainer,
  maxEntries: number,
): void {
  const tokens = Object.keys(container.entryParticipants ?? {})
  if (tokens.length <= maxEntries) {
    return
  }

  const overflowCount = tokens.length - maxEntries
  for (const token of tokens.slice(0, overflowCount)) {
    delete container.entryParticipants?.[token]
  }
}

export function storeSessionEntryParticipant(
  session: SessionRecord,
  values: unknown,
): { token: string; values: SessionEntryParticipantValues } {
  const container = getSessionEntryParticipantContainer(session)
  const stored = storeEntryParticipant(container, values)
  const valuesBytes = Buffer.byteLength(JSON.stringify(stored.values), 'utf8')

  if (valuesBytes > MAX_SESSION_ENTRY_PARTICIPANT_VALUES_BYTES) {
    delete container.entryParticipants?.[stored.token]
    throw new SessionEntryParticipantStoreError('entry participant payload too large', 413)
  }

  pruneSessionEntryParticipants(container, MAX_SESSION_ENTRY_PARTICIPANTS)
  return stored
}

export function consumeSessionEntryParticipant(
  session: SessionRecord,
  token: string,
): SessionEntryParticipantValues | null {
  return consumeEntryParticipant(getSessionEntryParticipantContainer(session), token)
}

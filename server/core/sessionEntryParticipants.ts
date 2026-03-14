import { randomBytes } from 'crypto'
import type { SessionRecord } from './sessions.js'
import type { WaitingRoomSerializableValue } from '../../types/waitingRoom.js'

export type SessionEntryParticipantValues = Record<string, WaitingRoomSerializableValue>

interface SessionEntryParticipantContainer {
  entryParticipants?: Record<string, SessionEntryParticipantValues>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isSerializableValue(value: unknown): value is WaitingRoomSerializableValue {
  if (value == null) {
    return true
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isSerializableValue(entry))
  }

  if (!isRecord(value)) {
    return false
  }

  return Object.values(value).every((entry) => isSerializableValue(entry))
}

export function normalizeSessionEntryParticipantValues(value: unknown): SessionEntryParticipantValues {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => isSerializableValue(entry)),
  ) as SessionEntryParticipantValues
}

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

function generateEntryParticipantToken(): string {
  return randomBytes(8).toString('hex')
}

export function storeSessionEntryParticipant(
  session: SessionRecord,
  values: unknown,
): { token: string; values: SessionEntryParticipantValues } {
  const normalizedValues = normalizeSessionEntryParticipantValues(values)
  const container = getSessionEntryParticipantContainer(session)
  const token = generateEntryParticipantToken()
  container.entryParticipants ??= {}
  container.entryParticipants[token] = normalizedValues
  return { token, values: normalizedValues }
}

export function consumeSessionEntryParticipant(
  session: SessionRecord,
  token: string,
): SessionEntryParticipantValues | null {
  const container = getSessionEntryParticipantContainer(session)
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    return null
  }

  const values = container.entryParticipants?.[normalizedToken]
  if (!values) {
    return null
  }

  delete container.entryParticipants?.[normalizedToken]
  return values
}

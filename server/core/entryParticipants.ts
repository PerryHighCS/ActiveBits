import { randomBytes } from 'crypto'
import type { WaitingRoomSerializableValue } from '../../types/waitingRoom.js'
import { generateParticipantId } from './participantIds.js'

export type EntryParticipantValues = Record<string, WaitingRoomSerializableValue>

export interface EntryParticipantContainer {
  entryParticipants?: Record<string, EntryParticipantValues>
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

export function normalizeEntryParticipantValues(value: unknown): EntryParticipantValues {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => isSerializableValue(entry)),
  ) as EntryParticipantValues
}

function generateEntryParticipantToken(): string {
  return randomBytes(8).toString('hex')
}

export function storeEntryParticipant(
  container: EntryParticipantContainer,
  values: unknown,
): { token: string; values: EntryParticipantValues } {
  const normalizedValues = normalizeEntryParticipantValues(values)
  const participantId = typeof normalizedValues.participantId === 'string' && normalizedValues.participantId.trim().length > 0
    ? normalizedValues.participantId.trim()
    : generateParticipantId()
  const token = generateEntryParticipantToken()

  container.entryParticipants ??= {}
  const storedValues = {
    ...normalizedValues,
    participantId,
  }
  container.entryParticipants[token] = storedValues
  return { token, values: storedValues }
}

export function consumeEntryParticipant(
  container: EntryParticipantContainer,
  token: string,
): EntryParticipantValues | null {
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

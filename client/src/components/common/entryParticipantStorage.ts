import type { WaitingRoomSerializableValue } from '../../../../types/waitingRoom.js'

export interface EntryParticipantStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type EntryParticipantValueMap = Record<string, WaitingRoomSerializableValue>
export type EntryParticipantDestinationType = 'session' | 'solo'
export interface EntryParticipantLookupParams {
  activityName: string
  sessionId?: string
  isSoloSession: boolean
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

function normalizeEntryParticipantValues(values: Record<string, unknown>): EntryParticipantValueMap {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => isSerializableValue(value)),
  ) as EntryParticipantValueMap
}

export function buildEntryParticipantStorageKey(
  activityName: string,
  destinationType: EntryParticipantDestinationType,
  destinationId: string,
): string {
  return `entry-participant:${activityName}:${destinationType}:${destinationId}`
}

export function buildSessionEntryParticipantStorageKey(activityName: string, sessionId: string): string {
  return buildEntryParticipantStorageKey(activityName, 'session', sessionId)
}

export function buildSoloEntryParticipantStorageKey(activityName: string): string {
  return buildEntryParticipantStorageKey(activityName, 'solo', activityName)
}

export function persistEntryParticipantValues(
  storage: EntryParticipantStorageLike,
  storageKey: string,
  values: EntryParticipantValueMap,
  onWarn: (message: string, error: unknown) => void = console.warn,
): void {
  try {
    storage.setItem(storageKey, JSON.stringify(normalizeEntryParticipantValues(values)))
  } catch (error) {
    onWarn('[EntryParticipantStorage] Failed to persist entry participant values:', error)
  }
}

export function consumeEntryParticipantValues(
  storage: EntryParticipantStorageLike,
  storageKey: string,
  onWarn: (message: string, error: unknown) => void = console.warn,
): EntryParticipantValueMap | null {
  const raw = storage.getItem(storageKey)
  if (!raw) {
    return null
  }

  storage.removeItem(storageKey)

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return null
    }

    return normalizeEntryParticipantValues(parsed)
  } catch (error) {
    onWarn('[EntryParticipantStorage] Failed to parse entry participant values:', error)
    return null
  }
}

export function getEntryParticipantDisplayName(values: EntryParticipantValueMap | null): string | null {
  const value = values?.displayName
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function consumeEntryParticipantDisplayName(
  storage: EntryParticipantStorageLike,
  { activityName, sessionId, isSoloSession }: EntryParticipantLookupParams,
): string | null {
  const storageKey = isSoloSession
    ? buildSoloEntryParticipantStorageKey(activityName)
    : (sessionId ? buildSessionEntryParticipantStorageKey(activityName, sessionId) : null)

  if (!storageKey) {
    return null
  }

  return getEntryParticipantDisplayName(consumeEntryParticipantValues(storage, storageKey))
}

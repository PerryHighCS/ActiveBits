import type { WaitingRoomSerializableValue } from '../../../../types/waitingRoom.js'

export interface EntryParticipantStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type EntryParticipantValueMap = Record<string, WaitingRoomSerializableValue>
export type EntryParticipantDestinationType = 'session' | 'solo'
type EntryParticipantHandoff =
  | { kind: 'values'; values: EntryParticipantValueMap }
  | { kind: 'token'; token: string; persistentHash?: string }

export interface EntryParticipantLookupParams {
  activityName: string
  sessionId?: string
  isSoloSession: boolean
}

interface EntryParticipantFetchResponse {
  values?: unknown
}

export interface EntryParticipantFetchLike {
  (input: string, init?: RequestInit): Promise<{
    ok: boolean
    status: number
    json(): Promise<unknown>
  }>
}

const pendingTokenConsumeRequests = new Map<string, Promise<EntryParticipantValueMap | null>>()

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

function isEntryParticipantHandoff(value: unknown): value is EntryParticipantHandoff {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'values') {
    return isRecord(value.values)
  }

  return value.kind === 'token'
    && typeof value.token === 'string'
    && (value.persistentHash === undefined || typeof value.persistentHash === 'string')
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
    storage.setItem(storageKey, JSON.stringify({
      kind: 'values',
      values: normalizeEntryParticipantValues(values),
    } satisfies EntryParticipantHandoff))
  } catch (error) {
    onWarn('[EntryParticipantStorage] Failed to persist entry participant values:', error)
  }
}

export function persistEntryParticipantToken(
  storage: EntryParticipantStorageLike,
  storageKey: string,
  token: string,
  options: { persistentHash?: string } = {},
  onWarn: (message: string, error: unknown) => void = console.warn,
): void {
  try {
    storage.setItem(storageKey, JSON.stringify({
      kind: 'token',
      token,
      ...(typeof options.persistentHash === 'string' ? { persistentHash: options.persistentHash } : {}),
    } satisfies EntryParticipantHandoff))
  } catch (error) {
    onWarn('[EntryParticipantStorage] Failed to persist entry participant token:', error)
  }
}

function readEntryParticipantHandoff(
  storage: EntryParticipantStorageLike,
  storageKey: string,
  onWarn: (message: string, error: unknown) => void = console.warn,
): EntryParticipantHandoff | null {
  const raw = storage.getItem(storageKey)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isEntryParticipantHandoff(parsed)) {
      storage.removeItem(storageKey)
      return null
    }

    if (parsed.kind === 'values') {
      return {
        kind: 'values',
        values: normalizeEntryParticipantValues(parsed.values),
      }
    }

    return parsed
  } catch (error) {
    storage.removeItem(storageKey)
    onWarn('[EntryParticipantStorage] Failed to parse entry participant values:', error)
    return null
  }
}

export function consumeEntryParticipantValues(
  storage: EntryParticipantStorageLike,
  storageKey: string,
  onWarn: (message: string, error: unknown) => void = console.warn,
): EntryParticipantValueMap | null {
  const handoff = readEntryParticipantHandoff(storage, storageKey, onWarn)
  if (!handoff) {
    return null
  }

  if (handoff.kind !== 'values') {
    return null
  }

  storage.removeItem(storageKey)
  return handoff.values
}

export function hasStoredEntryParticipantHandoff(
  storage: EntryParticipantStorageLike,
  storageKey: string,
  onWarn: (message: string, error: unknown) => void = console.warn,
): boolean {
  return readEntryParticipantHandoff(storage, storageKey, onWarn) != null
}

export function buildSessionEntryParticipantSubmitApiUrl(sessionId: string): string {
  return `/api/session/${encodeURIComponent(sessionId)}/entry-participant`
}

export function buildSessionEntryParticipantConsumeApiUrl(sessionId: string): string {
  return `/api/session/${encodeURIComponent(sessionId)}/entry-participant/consume`
}

export function buildPersistentEntryParticipantSubmitApiUrl(hash: string, activityName: string): string {
  const query = new URLSearchParams({ activityName })
  return `/api/persistent-session/${encodeURIComponent(hash)}/entry-participant?${query.toString()}`
}

export function buildPersistentEntryParticipantConsumeApiUrl(hash: string, activityName: string): string {
  const query = new URLSearchParams({ activityName })
  return `/api/persistent-session/${encodeURIComponent(hash)}/entry-participant/consume?${query.toString()}`
}

export async function consumeResolvedEntryParticipantValues(
  storage: EntryParticipantStorageLike,
  { activityName, sessionId, isSoloSession }: EntryParticipantLookupParams,
  fetchImpl: EntryParticipantFetchLike | null = typeof fetch === 'function' ? fetch.bind(globalThis) as EntryParticipantFetchLike : null,
): Promise<EntryParticipantValueMap | null> {
  const storageKey = isSoloSession
    ? buildSoloEntryParticipantStorageKey(activityName)
    : (sessionId ? buildSessionEntryParticipantStorageKey(activityName, sessionId) : null)

  if (!storageKey) {
    return null
  }

  const handoff = readEntryParticipantHandoff(storage, storageKey)
  if (!handoff) {
    return null
  }

  if (handoff.kind === 'values') {
    storage.removeItem(storageKey)
    return handoff.values
  }

  if (fetchImpl == null) {
    return null
  }

  const pendingRequestKey = `${storageKey}:${handoff.token}`
  const pendingRequest = pendingTokenConsumeRequests.get(pendingRequestKey)
  if (pendingRequest) {
    return pendingRequest
  }

  const requestPromise = (async () => {
    const apiUrl = isSoloSession
      ? (typeof handoff.persistentHash === 'string' && handoff.persistentHash.length > 0
        ? buildPersistentEntryParticipantConsumeApiUrl(handoff.persistentHash, activityName)
        : null)
      : (sessionId ? buildSessionEntryParticipantConsumeApiUrl(sessionId) : null)

    if (!apiUrl) {
      return null
    }

    const response = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ token: handoff.token }),
    })
    if (!response.ok) {
      if (response.status === 404) {
        storage.removeItem(storageKey)
      }
      return null
    }

    const payload = (await response.json()) as EntryParticipantFetchResponse
    storage.removeItem(storageKey)
    return normalizeEntryParticipantValues(
      isRecord(payload.values) ? payload.values : {},
    )
  })().catch(() => {
    return null
  }).finally(() => {
    pendingTokenConsumeRequests.delete(pendingRequestKey)
  })

  pendingTokenConsumeRequests.set(pendingRequestKey, requestPromise)
  return requestPromise
}

export function getEntryParticipantDisplayName(values: EntryParticipantValueMap | null): string | null {
  const value = values?.displayName
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getEntryParticipantParticipantId(values: EntryParticipantValueMap | null): string | null {
  const value = values?.participantId
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function consumeEntryParticipantDisplayName(
  storage: EntryParticipantStorageLike,
  params: EntryParticipantLookupParams,
  fetchImpl?: EntryParticipantFetchLike | null,
): Promise<string | null> {
  return getEntryParticipantDisplayName(await consumeResolvedEntryParticipantValues(storage, params, fetchImpl))
}

export async function consumeEntryParticipantParticipantId(
  storage: EntryParticipantStorageLike,
  params: EntryParticipantLookupParams,
  fetchImpl?: EntryParticipantFetchLike | null,
): Promise<string | null> {
  return getEntryParticipantParticipantId(await consumeResolvedEntryParticipantValues(storage, params, fetchImpl))
}

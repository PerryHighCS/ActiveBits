import {
  getEntryParticipantDisplayName,
  getEntryParticipantParticipantId,
  persistEntryParticipantToken,
  persistEntryParticipantValues,
  type EntryParticipantFetchLike,
  type EntryParticipantStorageLike,
  type EntryParticipantValueMap,
} from './entryParticipantStorage'
import { persistSessionParticipantContext } from './sessionParticipantContext'

export interface WaitingRoomHandoffPersistenceParams {
  storage: EntryParticipantStorageLike | null
  storageKey: string
  values: EntryParticipantValueMap
  submitApiUrl: string
  participantContextStorage?: EntryParticipantStorageLike | null
  sessionParticipantContextSessionId?: string
  persistentHash?: string
  fetchImpl?: EntryParticipantFetchLike | null
  onWarn?: (message: string, error: unknown) => void
}

export async function persistWaitingRoomServerBackedHandoff({
  storage,
  storageKey,
  values,
  submitApiUrl,
  participantContextStorage = storage,
  sessionParticipantContextSessionId,
  persistentHash,
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) as EntryParticipantFetchLike : null,
  onWarn = console.warn,
}: WaitingRoomHandoffPersistenceParams): Promise<void> {
  if (!fetchImpl) {
    return
  }

  const resolvedParticipantContextStorage = participantContextStorage ?? storage

  if (sessionParticipantContextSessionId && resolvedParticipantContextStorage) {
    persistSessionParticipantContext(resolvedParticipantContextStorage, sessionParticipantContextSessionId, {
      studentName: getEntryParticipantDisplayName(values),
      studentId: getEntryParticipantParticipantId(values),
    }, onWarn)
  }

  try {
    const response = await fetchImpl(submitApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        values,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to store waiting-room handoff (${response.status})`)
    }

    const payload = await response.json() as { entryParticipantToken?: unknown; values?: unknown }
    if (
      typeof sessionParticipantContextSessionId === 'string'
      && resolvedParticipantContextStorage
      && typeof payload.values === 'object'
      && payload.values !== null
      && !Array.isArray(payload.values)
    ) {
      const responseValues = payload.values as EntryParticipantValueMap
      persistSessionParticipantContext(resolvedParticipantContextStorage, sessionParticipantContextSessionId, {
        studentName: getEntryParticipantDisplayName(responseValues),
        studentId: getEntryParticipantParticipantId(responseValues),
      }, onWarn)
    }

    if (!storage) {
      return
    }

    const token = typeof payload.entryParticipantToken === 'string' ? payload.entryParticipantToken.trim() : ''
    if (!token) {
      throw new Error('Missing entry participant token')
    }

    persistEntryParticipantToken(storage, storageKey, token, {
      ...(typeof persistentHash === 'string' ? { persistentHash } : {}),
    }, onWarn)
  } catch (error) {
    onWarn('[WaitingRoom] Failed to store entry participant on server, falling back to client handoff:', error)
    if (storage) {
      persistEntryParticipantValues(storage, storageKey, values, onWarn)
    }
  }
}

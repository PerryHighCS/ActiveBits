import {
  persistEntryParticipantToken,
  persistEntryParticipantValues,
  type EntryParticipantFetchLike,
  type EntryParticipantStorageLike,
  type EntryParticipantValueMap,
} from './entryParticipantStorage'

export interface WaitingRoomHandoffPersistenceParams {
  storage: EntryParticipantStorageLike | null
  storageKey: string
  values: EntryParticipantValueMap
  submitApiUrl: string
  persistentHash?: string
  fetchImpl?: EntryParticipantFetchLike | null
  onWarn?: (message: string, error: unknown) => void
}

export async function persistWaitingRoomServerBackedHandoff({
  storage,
  storageKey,
  values,
  submitApiUrl,
  persistentHash,
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) as EntryParticipantFetchLike : null,
  onWarn = console.warn,
}: WaitingRoomHandoffPersistenceParams): Promise<void> {
  if (!storage || !fetchImpl) {
    return
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

    const payload = await response.json() as { entryParticipantToken?: unknown }
    const token = typeof payload.entryParticipantToken === 'string' ? payload.entryParticipantToken.trim() : ''
    if (!token) {
      throw new Error('Missing entry participant token')
    }

    persistEntryParticipantToken(storage, storageKey, token, {
      ...(typeof persistentHash === 'string' ? { persistentHash } : {}),
    }, onWarn)
  } catch (error) {
    onWarn('[WaitingRoom] Failed to store entry participant on server, falling back to client handoff:', error)
    persistEntryParticipantValues(storage, storageKey, values, onWarn)
  }
}

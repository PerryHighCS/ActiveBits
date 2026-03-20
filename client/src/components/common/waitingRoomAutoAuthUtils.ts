import { buildPersistentTeacherCodeApiUrl } from './waitingRoomUtils'

export interface WaitingRoomTeacherCodeResponse {
  teacherCode?: string
}

export interface WaitingRoomWebSocketLike {
  send: (data: string) => void
}

export type WaitingRoomAutoAuthFetchLike = typeof fetch

export interface AttemptWaitingRoomAutoTeacherAuthParams {
  shouldAutoAuth: boolean
  hash: string
  activityName: string
  ws: WaitingRoomWebSocketLike
  fetchImpl?: WaitingRoomAutoAuthFetchLike | null
  onError?: (message: string, error: unknown) => void
}

export async function attemptWaitingRoomAutoTeacherAuth({
  shouldAutoAuth,
  hash,
  activityName,
  ws,
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) as WaitingRoomAutoAuthFetchLike : null,
  onError = (message, error) => console.error(message, error),
}: AttemptWaitingRoomAutoTeacherAuthParams): Promise<void> {
  if (!shouldAutoAuth || !fetchImpl) {
    return
  }

  try {
    const response = await fetchImpl(buildPersistentTeacherCodeApiUrl(hash, activityName), {
      credentials: 'include',
    })
    const data = await response.json() as WaitingRoomTeacherCodeResponse
    const teacherCode = typeof data.teacherCode === 'string' ? data.teacherCode.trim() : ''
    if (!teacherCode) {
      return
    }

    try {
      ws.send(JSON.stringify({
        type: 'verify-teacher-code',
        teacherCode,
      }))
    } catch (sendError) {
      onError('Failed to send teacher code over WS:', sendError)
    }
  } catch (fetchError) {
    onError('Failed to fetch teacher code:', fetchError)
  }
}

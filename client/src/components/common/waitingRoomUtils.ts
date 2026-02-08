export interface LocationLike {
  protocol: string
  host: string
  search: string
  href: string
}

export type WaitingRoomMessage =
  | { type: 'waiter-count'; count: number }
  | { type: 'session-started'; sessionId: string }
  | { type: 'session-ended' }
  | { type: 'teacher-authenticated'; sessionId: string }
  | { type: 'teacher-code-error'; error: string }

export interface WaitingRoomRawMessage {
  type: string
  [key: string]: unknown
}

export function getWaiterMessage(waiterCount: number): string {
  const otherWaiters = Math.max(waiterCount - 1, 0)
  if (otherWaiters === 0) return 'You are the first one here!'
  if (otherWaiters === 1) return 'You and 1 other person waiting'
  return `You and ${otherWaiters} others waiting`
}

export function buildPersistentSessionWsUrl(location: LocationLike, hash: string, activityName: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query = new URLSearchParams({
    hash,
    activityName,
  })
  return `${protocol}//${location.host}/ws/persistent-session?${query.toString()}`
}

export function buildPersistentTeacherCodeApiUrl(hash: string, activityName: string): string {
  const query = new URLSearchParams({
    activityName,
  })
  return `/api/persistent-session/${encodeURIComponent(hash)}/teacher-code?${query.toString()}`
}

export function parseWaitingRoomMessage(data: string): WaitingRoomRawMessage | null {
  try {
    const parsed = JSON.parse(data) as unknown
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed as WaitingRoomRawMessage
    }
    return null
  } catch {
    return null
  }
}

export function isWaitingRoomMessage(message: WaitingRoomRawMessage): message is WaitingRoomMessage {
  if (message.type === 'waiter-count') {
    return typeof message.count === 'number'
  }
  if (message.type === 'session-started') {
    return typeof message.sessionId === 'string'
  }
  if (message.type === 'session-ended') {
    return true
  }
  if (message.type === 'teacher-authenticated') {
    return typeof message.sessionId === 'string'
  }
  if (message.type === 'teacher-code-error') {
    return typeof message.error === 'string'
  }
  return false
}

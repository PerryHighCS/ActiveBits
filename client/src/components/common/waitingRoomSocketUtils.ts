import { attemptWaitingRoomAutoTeacherAuth, type AttemptWaitingRoomAutoTeacherAuthParams } from './waitingRoomAutoAuthUtils'
import { isWaitingRoomMessage, parseWaitingRoomMessage, type WaitingRoomMessage } from './waitingRoomUtils'
import { resolveWaitingRoomMessageTransition } from './waitingRoomTransitionUtils'

export interface WaitingRoomSocketLike {
  readyState: number
  close: () => void
  send: (data: string) => void
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
}

export interface AttachWaitingRoomSocketHandlersParams {
  ws: WaitingRoomSocketLike
  shouldAutoAuth: boolean
  hash: string
  activityName: string
  queryString: string
  hasNavigatedRef: { current: boolean }
  teacherAuthRequestedRef: { current: boolean }
  setWaiterCount: (count: number) => void
  setError: (error: string | null) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  navigate: (path: string) => void | Promise<void>
  onParseError?: (message: string, payload: unknown) => void
  attemptAutoTeacherAuth?: (params: AttemptWaitingRoomAutoTeacherAuthParams) => Promise<void>
}

export function attachWaitingRoomSocketHandlers({
  ws,
  shouldAutoAuth,
  hash,
  activityName,
  queryString,
  hasNavigatedRef,
  teacherAuthRequestedRef,
  setWaiterCount,
  setError,
  setIsSubmitting,
  navigate,
  onParseError = (message, payload) => console.error(message, payload),
  attemptAutoTeacherAuth = attemptWaitingRoomAutoTeacherAuth,
}: AttachWaitingRoomSocketHandlersParams): void {
  const navigateOnce = (path: string) => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
    void navigate(path)
  }

  ws.onopen = () => {
    setError(null)
    void attemptAutoTeacherAuth({
      shouldAutoAuth,
      hash,
      activityName,
      ws,
    })
  }

  ws.onmessage = (event) => {
    const rawMessage = parseWaitingRoomMessage(String(event.data))
    if (!rawMessage) {
      onParseError('Failed to parse WebSocket message:', event.data)
      return
    }
    if (!isWaitingRoomMessage(rawMessage)) {
      return
    }

    if (hasNavigatedRef.current) {
      return
    }

    applyWaitingRoomSocketMessage({
      message: rawMessage,
      activityName,
      queryString,
      teacherAuthRequestedRef,
      setWaiterCount,
      setError,
      setIsSubmitting,
      navigateOnce,
    })
  }

  ws.onerror = () => {
    if (hasNavigatedRef.current) return
    setError('Connection error.')
  }

  ws.onclose = () => {
    if (hasNavigatedRef.current) return
    setError('Connection closed.')
  }
}

interface ApplyWaitingRoomSocketMessageParams {
  message: WaitingRoomMessage
  activityName: string
  queryString: string
  teacherAuthRequestedRef: { current: boolean }
  setWaiterCount: (count: number) => void
  setError: (error: string | null) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  navigateOnce: (path: string) => void
}

function applyWaitingRoomSocketMessage({
  message,
  activityName,
  queryString,
  teacherAuthRequestedRef,
  setWaiterCount,
  setError,
  setIsSubmitting,
  navigateOnce,
}: ApplyWaitingRoomSocketMessageParams): void {
  const resolution = resolveWaitingRoomMessageTransition({
    message,
    teacherAuthRequested: teacherAuthRequestedRef.current,
    activityName,
    queryString,
  })

  if (typeof resolution.waiterCount === 'number') {
    setWaiterCount(resolution.waiterCount)
  }

  if (typeof resolution.error === 'string' || resolution.error === null) {
    setError(resolution.error)
  }

  if (typeof resolution.isSubmitting === 'boolean') {
    setIsSubmitting(resolution.isSubmitting)
  }

  if (resolution.clearTeacherAuthRequested) {
    teacherAuthRequestedRef.current = false
  }

  if (typeof resolution.navigateTo === 'string') {
    navigateOnce(resolution.navigateTo)
  }
}

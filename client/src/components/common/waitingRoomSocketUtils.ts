import { attemptWaitingRoomAutoTeacherAuth, type AttemptWaitingRoomAutoTeacherAuthParams } from './waitingRoomAutoAuthUtils'
import { isWaitingRoomMessage, parseWaitingRoomMessage, type WaitingRoomMessage } from './waitingRoomUtils'
import { resolveWaitingRoomMessageTransition } from './waitingRoomTransitionUtils'
import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'
import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'

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
  currentEntryOutcomeRef: { current: PersistentSessionEntryOutcome }
  currentEntryPolicyRef: { current: PersistentSessionEntryPolicy | undefined }
  hasNavigatedRef: { current: boolean }
  teacherAuthRequestedRef: { current: boolean }
  setWaiterCount: (count: number) => void
  setError: (error: string | null) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  setEntryOutcome: (entryOutcome: PersistentSessionEntryOutcome) => void
  setStartedSessionId: (sessionId: string | undefined) => void
  navigate: (path: string) => void | Promise<void>
  onTeacherAuthenticated?: (message: Extract<WaitingRoomMessage, { type: 'teacher-authenticated' }>) => void
  onParseError?: (message: string, payload: unknown) => void
  attemptAutoTeacherAuth?: (params: AttemptWaitingRoomAutoTeacherAuthParams) => Promise<void>
}

export function attachWaitingRoomSocketHandlers({
  ws,
  shouldAutoAuth,
  hash,
  activityName,
  queryString,
  currentEntryOutcomeRef,
  currentEntryPolicyRef,
  hasNavigatedRef,
  teacherAuthRequestedRef,
  setWaiterCount,
  setError,
  setIsSubmitting,
  setEntryOutcome,
  setStartedSessionId,
  navigate,
  onTeacherAuthenticated,
  onParseError = (message, payload) => console.error(message, payload),
  attemptAutoTeacherAuth = attemptWaitingRoomAutoTeacherAuth,
}: AttachWaitingRoomSocketHandlersParams): void {
  const navigateOnce = (path: string) => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    if (ws.readyState === 1 /* OPEN */ || ws.readyState === 0 /* CONNECTING */) {
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
      currentEntryOutcome: currentEntryOutcomeRef.current,
      currentEntryPolicy: currentEntryPolicyRef.current,
      teacherAuthRequestedRef,
      setWaiterCount,
      setError,
      setIsSubmitting,
      setEntryOutcome,
      setStartedSessionId,
      navigateOnce,
      onTeacherAuthenticated,
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
  currentEntryOutcome: PersistentSessionEntryOutcome
  currentEntryPolicy?: PersistentSessionEntryPolicy
  teacherAuthRequestedRef: { current: boolean }
  setWaiterCount: (count: number) => void
  setError: (error: string | null) => void
  setIsSubmitting: (isSubmitting: boolean) => void
  setEntryOutcome: (entryOutcome: PersistentSessionEntryOutcome) => void
  setStartedSessionId: (sessionId: string | undefined) => void
  navigateOnce: (path: string) => void
  onTeacherAuthenticated?: (message: Extract<WaitingRoomMessage, { type: 'teacher-authenticated' }>) => void
}

function applyWaitingRoomSocketMessage({
  message,
  activityName,
  queryString,
  currentEntryOutcome,
  currentEntryPolicy,
  teacherAuthRequestedRef,
  setWaiterCount,
  setError,
  setIsSubmitting,
  setEntryOutcome,
  setStartedSessionId,
  navigateOnce,
  onTeacherAuthenticated,
}: ApplyWaitingRoomSocketMessageParams): void {
  const resolution = resolveWaitingRoomMessageTransition({
    message,
    teacherAuthRequested: teacherAuthRequestedRef.current,
    activityName,
    queryString,
    currentEntryOutcome,
    currentEntryPolicy,
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

  if (typeof resolution.nextEntryOutcome === 'string') {
    setEntryOutcome(resolution.nextEntryOutcome)
  }

  if (typeof resolution.nextStartedSessionId === 'string') {
    setStartedSessionId(resolution.nextStartedSessionId)
  } else if (resolution.nextStartedSessionId === null) {
    setStartedSessionId(undefined)
  }

  if (resolution.clearTeacherAuthRequested) {
    teacherAuthRequestedRef.current = false
  }

  if (message.type === 'teacher-authenticated') {
    onTeacherAuthenticated?.(message)
  }

  if (typeof resolution.navigateTo === 'string') {
    navigateOnce(resolution.navigateTo)
  }
}

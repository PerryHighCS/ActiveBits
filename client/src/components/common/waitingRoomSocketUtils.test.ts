import assert from 'node:assert/strict'
import test from 'node:test'
import { attachWaitingRoomSocketHandlers, type WaitingRoomSocketLike } from './waitingRoomSocketUtils'

function createSocket(readyState = 1): WaitingRoomSocketLike {
  return {
    readyState,
    close() {
      this.readyState = 3
    },
    send() {},
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  }
}

void test('attachWaitingRoomSocketHandlers clears errors and attempts auto-auth on open', async () => {
  const ws = createSocket()
  const errors: Array<string | null> = []
  const attempts: Array<{ shouldAutoAuth: boolean; hash: string; activityName: string }> = []

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: true,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '',
    currentEntryOutcomeRef: { current: 'wait' },
    currentEntryPolicyRef: { current: 'instructor-required' },
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: false },
    setWaiterCount() {},
    setError(value) {
      errors.push(value)
    },
    setIsSubmitting() {},
    setEntryOutcome() {},
    setStartedSessionId() {},
    navigate() {},
    attemptAutoTeacherAuth: async ({ shouldAutoAuth, hash, activityName }) => {
      attempts.push({ shouldAutoAuth, hash, activityName })
    },
  })

  ws.onopen?.(new Event('open'))
  await Promise.resolve()

  assert.deepEqual(errors, [null])
  assert.deepEqual(attempts, [{
    shouldAutoAuth: true,
    hash: 'hash-1',
    activityName: 'java-string-practice',
  }])
})

void test('attachWaitingRoomSocketHandlers updates waiter count from valid messages', () => {
  const ws = createSocket()
  const waiterCounts: number[] = []

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '',
    currentEntryOutcomeRef: { current: 'wait' },
    currentEntryPolicyRef: { current: 'instructor-required' },
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: false },
    setWaiterCount(count) {
      waiterCounts.push(count)
    },
    setError() {},
    setIsSubmitting() {},
    setEntryOutcome() {},
    setStartedSessionId() {},
    navigate() {},
  })

  ws.onmessage?.(new MessageEvent('message', {
    data: JSON.stringify({ type: 'waiter-count', count: 3 }),
  }))

  assert.deepEqual(waiterCounts, [3])
})

void test('attachWaitingRoomSocketHandlers routes through navigateOnce and closes socket once', () => {
  const ws = createSocket(1)
  const navigations: string[] = []
  const hasNavigatedRef = { current: false }

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    currentEntryOutcomeRef: { current: 'wait' },
    currentEntryPolicyRef: { current: 'instructor-required' },
    hasNavigatedRef,
    teacherAuthRequestedRef: { current: true },
    setWaiterCount() {},
    setError() {},
    setIsSubmitting() {},
    setEntryOutcome() {},
    setStartedSessionId() {},
    navigate(path) {
      navigations.push(path)
    },
  })

  ws.onmessage?.(new MessageEvent('message', {
    data: JSON.stringify({ type: 'session-started', sessionId: 'session-1' }),
  }))
  ws.onmessage?.(new MessageEvent('message', {
    data: JSON.stringify({ type: 'session-started', sessionId: 'session-2' }),
  }))

  assert.deepEqual(navigations, ['/manage/java-string-practice/session-1?foo=bar'])
  assert.equal(hasNavigatedRef.current, true)
  assert.equal(ws.readyState, 3)
})

void test('attachWaitingRoomSocketHandlers exposes teacher-authenticated bootstrap payload before navigation', () => {
  const ws = createSocket(1)
  const navigations: string[] = []
  const bootstrapPayloads: Array<{ sessionId: string; payload?: Record<string, unknown> }> = []

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'syncdeck',
    queryString: '',
    currentEntryOutcomeRef: { current: 'wait' },
    currentEntryPolicyRef: { current: 'instructor-required' },
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: true },
    setWaiterCount() {},
    setError() {},
    setIsSubmitting() {},
    setEntryOutcome() {},
    setStartedSessionId() {},
    navigate(path) {
      navigations.push(path)
    },
    onTeacherAuthenticated(message) {
      bootstrapPayloads.push({
        sessionId: message.sessionId,
        payload: message.createSessionPayload,
      })
    },
  })

  ws.onmessage?.(new MessageEvent('message', {
    data: JSON.stringify({
      type: 'teacher-authenticated',
      sessionId: 'session-1',
      createSessionPayload: {
        instructorPasscode: 'pass-1',
      },
    }),
  }))

  assert.deepEqual(bootstrapPayloads, [{
    sessionId: 'session-1',
    payload: {
      instructorPasscode: 'pass-1',
    },
  }])
  assert.deepEqual(navigations, ['/manage/syncdeck/session-1'])
})

void test('attachWaitingRoomSocketHandlers reports parse errors for malformed messages', () => {
  const ws = createSocket()
  const parseErrors: unknown[] = []

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '',
    currentEntryOutcomeRef: { current: 'wait' },
    currentEntryPolicyRef: { current: 'instructor-required' },
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: false },
    setWaiterCount() {},
    setError() {},
    setIsSubmitting() {},
    setEntryOutcome() {},
    setStartedSessionId() {},
    navigate() {},
    onParseError(_message, payload) {
      parseErrors.push(payload)
    },
  })

  ws.onmessage?.(new MessageEvent('message', {
    data: 'not-json',
  }))

  assert.deepEqual(parseErrors, ['not-json'])
})

void test('attachWaitingRoomSocketHandlers applies lifecycle errors only before navigation', () => {
  const ws = createSocket()
  const errors: Array<string | null> = []
  const hasNavigatedRef = { current: false }

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '',
    currentEntryOutcomeRef: { current: 'wait' },
    currentEntryPolicyRef: { current: 'instructor-required' },
    hasNavigatedRef,
    teacherAuthRequestedRef: { current: false },
    setWaiterCount() {},
    setError(value) {
      errors.push(value)
    },
    setIsSubmitting() {},
    setEntryOutcome() {},
    setStartedSessionId() {},
    navigate() {},
  })

  ws.onerror?.(new Event('error'))
  hasNavigatedRef.current = true
  ws.onclose?.(new Event('close') as CloseEvent)

  assert.deepEqual(errors, ['Connection error.'])
})

void test('attachWaitingRoomSocketHandlers promotes live-or-solo students to join-live instead of navigating', () => {
  const ws = createSocket()
  const entryOutcomes: string[] = []
  const startedSessionIds: Array<string | undefined> = []
  const errors: Array<string | null> = []
  const submittingStates: boolean[] = []
  const navigations: string[] = []
  const teacherAuthRequestedRef = { current: false }

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    currentEntryOutcomeRef: { current: 'continue-solo' },
    currentEntryPolicyRef: { current: 'solo-allowed' },
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef,
    setWaiterCount() {},
    setError(value) {
      errors.push(value)
    },
    setIsSubmitting(value) {
      submittingStates.push(value)
    },
    setEntryOutcome(value) {
      entryOutcomes.push(value)
    },
    setStartedSessionId(value) {
      startedSessionIds.push(value)
    },
    navigate(path) {
      navigations.push(path)
    },
  })

  ws.onmessage?.(new MessageEvent('message', {
    data: JSON.stringify({ type: 'session-started', sessionId: 'session-1' }),
  }))

  assert.deepEqual(entryOutcomes, ['join-live'])
  assert.deepEqual(startedSessionIds, ['session-1'])
  assert.deepEqual(errors, [null])
  assert.deepEqual(submittingStates, [false])
  assert.deepEqual(navigations, [])
  assert.equal(teacherAuthRequestedRef.current, false)
})

void test('attachWaitingRoomSocketHandlers returns live-or-solo students to solo state when session ends', () => {
  const ws = createSocket()
  const entryOutcomes: string[] = []
  const startedSessionIds: Array<string | undefined> = []
  const errors: Array<string | null> = []
  const submittingStates: boolean[] = []
  const navigations: string[] = []

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '',
    currentEntryOutcomeRef: { current: 'join-live' },
    currentEntryPolicyRef: { current: 'solo-allowed' },
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: false },
    setWaiterCount() {},
    setError(value) {
      errors.push(value)
    },
    setIsSubmitting(value) {
      submittingStates.push(value)
    },
    setEntryOutcome(value) {
      entryOutcomes.push(value)
    },
    setStartedSessionId(value) {
      startedSessionIds.push(value)
    },
    navigate(path) {
      navigations.push(path)
    },
  })

  ws.onmessage?.(new MessageEvent('message', {
    data: JSON.stringify({ type: 'session-ended' }),
  }))

  assert.deepEqual(entryOutcomes, ['continue-solo'])
  assert.deepEqual(startedSessionIds, [undefined])
  assert.deepEqual(errors, [null])
  assert.deepEqual(submittingStates, [false])
  assert.deepEqual(navigations, [])
})

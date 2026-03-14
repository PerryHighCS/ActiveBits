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
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: false },
    setWaiterCount() {},
    setError(value) {
      errors.push(value)
    },
    setIsSubmitting() {},
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
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: false },
    setWaiterCount(count) {
      waiterCounts.push(count)
    },
    setError() {},
    setIsSubmitting() {},
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
    hasNavigatedRef,
    teacherAuthRequestedRef: { current: true },
    setWaiterCount() {},
    setError() {},
    setIsSubmitting() {},
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

void test('attachWaitingRoomSocketHandlers reports parse errors for malformed messages', () => {
  const ws = createSocket()
  const parseErrors: unknown[] = []

  attachWaitingRoomSocketHandlers({
    ws,
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    queryString: '',
    hasNavigatedRef: { current: false },
    teacherAuthRequestedRef: { current: false },
    setWaiterCount() {},
    setError() {},
    setIsSubmitting() {},
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
    hasNavigatedRef,
    teacherAuthRequestedRef: { current: false },
    setWaiterCount() {},
    setError(value) {
      errors.push(value)
    },
    setIsSubmitting() {},
    navigate() {},
  })

  ws.onerror?.(new Event('error'))
  hasNavigatedRef.current = true
  ws.onclose?.(new Event('close') as CloseEvent)

  assert.deepEqual(errors, ['Connection error.'])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createTimedAbortRequest, readLearnSyncDeckWaitingStatus } from './learnSyncDeckWaitingUtils.js'

void test('readLearnSyncDeckWaitingStatus returns an active launch URL without caching', async () => {
  let requestedUrl = ''
  let init: RequestInit | undefined
  const controller = new AbortController()
  const result = await readLearnSyncDeckWaitingStatus(async (input, options) => {
    requestedUrl = String(input)
    init = options
    return new Response(JSON.stringify({ state: 'active', studentLaunchUrl: '/session-1' }), { status: 200 })
  }, controller.signal)

  assert.deepEqual(result, { state: 'active', studentLaunchUrl: '/session-1' })
  assert.equal(requestedUrl, '/api/integrations/learn/v1/activities/syncdeck/wait/status')
  assert.equal(init?.cache, 'no-store')
  assert.equal(init?.credentials, 'same-origin')
  assert.equal(init?.signal, controller.signal)
})

void test('readLearnSyncDeckWaitingStatus surfaces a safe server error', async () => {
  console.info('[TEST] Expected unavailable Learn waiting-room entry error.')
  await assert.rejects(
    () => readLearnSyncDeckWaitingStatus(async () => new Response(JSON.stringify({ error: 'Waiting-room entry is unavailable' }), { status: 404 })),
    /waiting-room entry is unavailable/i,
  )
})

void test('readLearnSyncDeckWaitingStatus falls back to a safe error for a non-JSON response', async () => {
  console.info('[TEST] Expected non-JSON Learn waiting-room gateway error.')
  await assert.rejects(
    () => readLearnSyncDeckWaitingStatus(async () => new Response('<html>gateway error</html>', { status: 502 })),
    /waiting-room entry is no longer available/i,
  )
})

void test('readLearnSyncDeckWaitingStatus rejects unsafe student launch URLs', async () => {
  for (const studentLaunchUrl of ['https://untrusted.example/session', '//untrusted.example/session', '/\\untrusted.example/session']) {
    const result = await readLearnSyncDeckWaitingStatus(async () => new Response(JSON.stringify({
      state: 'active',
      studentLaunchUrl,
    })))

    assert.deepEqual(result, { state: 'active', studentLaunchUrl: null })
  }
})

void test('createTimedAbortRequest aborts a stalled waiting-room status request', () => {
  console.info('[TEST] Expected timed-out Learn waiting-room status request.')
  let timeoutCallback: (() => void) | undefined
  let clearedTimeout: number | undefined
  const request = createTimedAbortRequest(15_000, {
    setTimeout: (callback, _timeoutMs) => {
      timeoutCallback = callback as () => void
      return 42
    },
    clearTimeout: (timeout) => {
      clearedTimeout = timeout
    },
  })

  assert.equal(request.controller.signal.aborted, false)
  timeoutCallback?.()
  assert.equal(request.controller.signal.aborted, true)

  request.cancelTimeout()
  assert.equal(clearedTimeout, 42)
})

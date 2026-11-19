import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeCreateSessionBootstrapPayload,
  storeCreateSessionBootstrapPayload,
} from '@src/components/common/manageDashboardUtils'
import {
  hasRouterStatePasscode,
  recoverCommissionedIdeasInstructorPasscode,
  recoverInstructorPasscodeOnce,
  resolveCommissionedIdeasInstructorPasscode,
  type RecoveryAttemptResult,
} from './passcode.js'

void test('manager passcode resolution follows the same-tab handoff decision table', () => {
  const cases = [
    {
      name: 'router payload',
      sessionId: 'session-1',
      locationState: { createSessionPayload: { instructorPasscode: 'router-pass' } },
      bootstrapPayload: null,
      expected: 'router-pass',
    },
    {
      name: 'conflicting handoffs prefer router state',
      sessionId: 'session-1',
      locationState: { createSessionPayload: { instructorPasscode: 'router-pass' } },
      bootstrapPayload: { instructorPasscode: 'memory-pass' },
      expected: 'router-pass',
    },
    {
      name: 'missing router payload uses memory handoff',
      sessionId: 'session-1',
      locationState: null,
      bootstrapPayload: { instructorPasscode: 'memory-pass' },
      expected: 'memory-pass',
    },
    {
      name: 'malformed router payload uses memory handoff',
      sessionId: 'session-1',
      locationState: { createSessionPayload: { instructorPasscode: [] } },
      bootstrapPayload: { instructorPasscode: 'memory-pass' },
      expected: 'memory-pass',
    },
    {
      name: 'blank credentials fail closed',
      sessionId: 'session-1',
      locationState: { createSessionPayload: { instructorPasscode: '  ' } },
      bootstrapPayload: { instructorPasscode: '' },
      expected: null,
    },
    {
      name: 'missing session fails closed',
      sessionId: undefined,
      locationState: { createSessionPayload: { instructorPasscode: 'router-pass' } },
      bootstrapPayload: { instructorPasscode: 'memory-pass' },
      expected: null,
    },
  ] as const

  for (const entry of cases) {
    const calls: string[] = []
    const actual = resolveCommissionedIdeasInstructorPasscode({
      sessionId: entry.sessionId,
      locationState: entry.locationState,
      readBootstrapPayload: (activityId, sessionId) => {
        calls.push(`${activityId}:${sessionId}`)
        return entry.bootstrapPayload
      },
    })
    assert.equal(actual, entry.expected, entry.name)
    assert.deepEqual(
      calls,
      entry.expected === 'router-pass' || !entry.sessionId ? [] : ['commissioned-ideas:session-1'],
      entry.name,
    )
  }
})

void test('manager passcode remains available across repeated Strict Mode reads', () => {
  const sessionId = 'strict-mode-session'
  storeCreateSessionBootstrapPayload('commissioned-ideas', sessionId, {
    instructorPasscode: 'memory-pass',
  }, undefined, { persistToSessionStorage: false })

  try {
    const sources = { sessionId, locationState: null }
    assert.equal(resolveCommissionedIdeasInstructorPasscode(sources), 'memory-pass')
    assert.equal(resolveCommissionedIdeasInstructorPasscode(sources), 'memory-pass')
  } finally {
    consumeCreateSessionBootstrapPayload('commissioned-ideas', sessionId)
  }
})

void test('hasRouterStatePasscode detects only a usable router-state passcode', () => {
  assert.equal(hasRouterStatePasscode({ createSessionPayload: { instructorPasscode: 'P' } }), true)
  assert.equal(hasRouterStatePasscode({ createSessionPayload: { instructorPasscode: '  ' } }), false)
  assert.equal(hasRouterStatePasscode({ createSessionPayload: null }), false)
  assert.equal(hasRouterStatePasscode(null), false)
  assert.equal(hasRouterStatePasscode('state'), false)
})

// Reload recovery decision table. Each step is the fake server's reply to the
// next request; `calls` is the exact request sequence the client must make.
type Reply = { status: number; body?: unknown } | 'network-error'
const EXCHANGE = 'GET /api/commissioned-ideas/s1/instructor-passcode'
const REISSUE = 'POST /api/session/s1/persistent-manager-capability'

const recoveryCases: { name: string; replies: Reply[]; expected: RecoveryAttemptResult; calls: string[] }[] = [
  {
    name: 'capability cookie present → passcode',
    replies: [{ status: 200, body: { instructorPasscode: 'PASS' } }],
    expected: { status: 'ok', passcode: 'PASS' },
    calls: [EXCHANGE],
  },
  {
    name: 'no cookie, persistent teacher cookie reissues → passcode on retry',
    replies: [{ status: 403 }, { status: 200, body: { success: true } }, { status: 200, body: { instructorPasscode: 'PASS' } }],
    expected: { status: 'ok', passcode: 'PASS' },
    calls: [EXCHANGE, REISSUE, EXCHANGE],
  },
  {
    name: 'no cookie and no persistent link → missing after one reissue attempt',
    replies: [{ status: 403 }, { status: 404 }],
    expected: { status: 'missing' },
    calls: [EXCHANGE, REISSUE],
  },
  {
    name: 'reissue rate-limited → unavailable (retryable by the user), no retry loop',
    replies: [{ status: 403 }, { status: 429 }],
    expected: { status: 'unavailable' },
    calls: [EXCHANGE, REISSUE],
  },
  {
    name: 'retry still refused → missing, only one reissue',
    replies: [{ status: 403 }, { status: 200 }, { status: 403 }],
    expected: { status: 'missing' },
    calls: [EXCHANGE, REISSUE, EXCHANGE],
  },
  {
    name: 'unknown session → missing without reissue',
    replies: [{ status: 404 }],
    expected: { status: 'missing' },
    calls: [EXCHANGE],
  },
  {
    name: 'malformed success body → missing',
    replies: [{ status: 200, body: { instructorPasscode: '' } }],
    expected: { status: 'missing' },
    calls: [EXCHANGE],
  },
  {
    name: 'network error → unavailable',
    replies: ['network-error'],
    expected: { status: 'unavailable' },
    calls: [EXCHANGE],
  },
  {
    name: 'exchange server error (store outage) → unavailable without reissue',
    replies: [{ status: 500 }],
    expected: { status: 'unavailable' },
    calls: [EXCHANGE],
  },
  {
    name: 'reissue server error → unavailable',
    replies: [{ status: 403 }, { status: 503 }],
    expected: { status: 'unavailable' },
    calls: [EXCHANGE, REISSUE],
  },
  {
    name: 'exchange after reissue hits a server error → unavailable',
    replies: [{ status: 403 }, { status: 200 }, { status: 500 }],
    expected: { status: 'unavailable' },
    calls: [EXCHANGE, REISSUE, EXCHANGE],
  },
]

for (const row of recoveryCases) {
  void test(`recoverCommissionedIdeasInstructorPasscode: ${row.name}`, async () => {
    const calls: string[] = []
    const credentials: (RequestCredentials | undefined)[] = []
    const replies = [...row.replies]
    const fakeFetch = async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      // Recorded, not asserted here: production code catches throws from fetch,
      // which would hide a failed assertion behind an expected `null` result.
      credentials.push(init?.credentials)
      const reply = replies.shift()
      if (reply === undefined || reply === 'network-error') throw new Error('[TEST] simulated network error')
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body ?? {} }
    }
    assert.deepEqual(await recoverCommissionedIdeasInstructorPasscode('s1', fakeFetch), row.expected)
    assert.deepEqual(calls, row.calls)
    assert.deepEqual(credentials, row.calls.map(() => 'include'), 'every recovery request must send cookies')
  })
}

void test('shared recovery: concurrent callers for one session share a single request sequence', async () => {
  const calls: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const fakeFetch = async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${input}`)
    await gate
    return { ok: true, status: 200, json: async () => ({ instructorPasscode: 'PASS' }) }
  }
  const first = recoverInstructorPasscodeOnce('s1', fakeFetch)
  const second = recoverInstructorPasscodeOnce('s1', fakeFetch)
  release()
  assert.deepEqual(await Promise.all([first, second]), [{ status: 'ok', passcode: 'PASS' }, { status: 'ok', passcode: 'PASS' }])
  assert.deepEqual(calls, [EXCHANGE], 'Strict Mode double effects must not send a second reissue')

  // After settling, a later recovery (for example a new reload) runs again.
  assert.deepEqual(await recoverInstructorPasscodeOnce('s1', fakeFetch), { status: 'ok', passcode: 'PASS' })
  assert.deepEqual(calls, [EXCHANGE, EXCHANGE])
})

void test('shared recovery: concurrent callers share one reissue POST on the 403 → reissue → exchange path', async () => {
  const calls: string[] = []
  const replies = [403, 200, 200]
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const fakeFetch = async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${input}`)
    await gate
    const status = replies.shift() ?? 500
    return { ok: status === 200, status, json: async () => ({ instructorPasscode: 'PASS' }) }
  }
  const first = recoverInstructorPasscodeOnce('s1', fakeFetch)
  const second = recoverInstructorPasscodeOnce('s1', fakeFetch)
  release()
  assert.deepEqual(await Promise.all([first, second]), [{ status: 'ok', passcode: 'PASS' }, { status: 'ok', passcode: 'PASS' }])
  assert.deepEqual(calls, [EXCHANGE, REISSUE, EXCHANGE])
  assert.equal(calls.filter((call) => call === REISSUE).length, 1, 'exactly one reissue POST')
})

void test('shared recovery: a stalled request hits the deadline, is aborted, and a later recovery starts fresh', async () => {
  let aborted = false
  const stalled = async (_input: string, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => { aborted = true })
    return { ok: true, status: 200, json: () => new Promise<unknown>(() => {}) } // body never finishes
  }
  assert.deepEqual(await recoverInstructorPasscodeOnce('s1', stalled, 20), { status: 'timeout' }, 'retryable, not missing')
  assert.equal(aborted, true, 'the stalled request is aborted')

  const healthy = async () => ({ ok: true, status: 200, json: async () => ({ instructorPasscode: 'PASS' }) })
  assert.deepEqual(await recoverInstructorPasscodeOnce('s1', healthy, 1000), { status: 'ok', passcode: 'PASS' }, 'the stalled entry was cleared')
})

void test('shared recovery: a definitive refusal is missing, not retryable', async () => {
  const refused = async () => ({ ok: false, status: 404, json: async () => ({}) })
  assert.deepEqual(await recoverInstructorPasscodeOnce('s1', refused, 1000), { status: 'missing' })
})

void test('shared recovery: a server error is retryable (unavailable), not missing', async () => {
  const outage = async () => ({ ok: false, status: 500, json: async () => ({}) })
  assert.deepEqual(await recoverInstructorPasscodeOnce('s1', outage, 1000), { status: 'unavailable' })
})

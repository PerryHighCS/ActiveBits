import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeCreateSessionBootstrapPayload,
  storeCreateSessionBootstrapPayload,
} from '@src/components/common/manageDashboardUtils'
import {
  hasRouterStatePasscode,
  recoverCommissionedIdeasInstructorPasscode,
  resolveCommissionedIdeasInstructorPasscode,
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

const recoveryCases: { name: string; replies: Reply[]; expected: string | null; calls: string[] }[] = [
  {
    name: 'capability cookie present → passcode',
    replies: [{ status: 200, body: { instructorPasscode: 'PASS' } }],
    expected: 'PASS',
    calls: [EXCHANGE],
  },
  {
    name: 'no cookie, persistent teacher cookie reissues → passcode on retry',
    replies: [{ status: 403 }, { status: 200, body: { success: true } }, { status: 200, body: { instructorPasscode: 'PASS' } }],
    expected: 'PASS',
    calls: [EXCHANGE, REISSUE, EXCHANGE],
  },
  {
    name: 'no cookie and no persistent link → null after one reissue attempt',
    replies: [{ status: 403 }, { status: 404 }],
    expected: null,
    calls: [EXCHANGE, REISSUE],
  },
  {
    name: 'reissue rate-limited → null, no retry loop',
    replies: [{ status: 403 }, { status: 429 }],
    expected: null,
    calls: [EXCHANGE, REISSUE],
  },
  {
    name: 'retry still refused → null, only one reissue',
    replies: [{ status: 403 }, { status: 200 }, { status: 403 }],
    expected: null,
    calls: [EXCHANGE, REISSUE, EXCHANGE],
  },
  {
    name: 'unknown session → null without reissue',
    replies: [{ status: 404 }],
    expected: null,
    calls: [EXCHANGE],
  },
  {
    name: 'malformed success body → null',
    replies: [{ status: 200, body: { instructorPasscode: '' } }],
    expected: null,
    calls: [EXCHANGE],
  },
  {
    name: 'network error → null',
    replies: ['network-error'],
    expected: null,
    calls: [EXCHANGE],
  },
]

for (const row of recoveryCases) {
  void test(`recoverCommissionedIdeasInstructorPasscode: ${row.name}`, async () => {
    const calls: string[] = []
    const replies = [...row.replies]
    const fakeFetch = async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      assert.equal(init?.credentials, 'include', 'every recovery request must send cookies')
      const reply = replies.shift()
      if (reply === undefined || reply === 'network-error') throw new Error('[TEST] simulated network error')
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body ?? {} }
    }
    assert.equal(await recoverCommissionedIdeasInstructorPasscode('s1', fakeFetch), row.expected)
    assert.deepEqual(calls, row.calls)
  })
}

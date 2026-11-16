import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeCreateSessionBootstrapPayload,
  storeCreateSessionBootstrapPayload,
} from '@src/components/common/manageDashboardUtils'
import { resolveCommissionedIdeasInstructorPasscode } from './passcode.js'

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

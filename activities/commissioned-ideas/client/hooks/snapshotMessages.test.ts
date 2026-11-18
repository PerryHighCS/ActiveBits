import test from 'node:test'
import assert from 'node:assert/strict'
import { isSnapshotMessage, managerSessionIdentity, managerViewForIdentity } from './useCommissionedIdeasSession.js'

// Every server broadcast that carries a snapshot must be listed here; a missing
// type silently freezes the client view (e.g. podium reveals would not appear).
const cases: [string, boolean][] = [
  ['commissioned-ideas:session-state', true],
  ['commissioned-ideas:registration-updated', true],
  ['commissioned-ideas:phase-changed', true],
  ['commissioned-ideas:podium-step', true],
  ['commissioned-ideas:error', false],
  ['commissioned-ideas:manager-auth', false],
  ['session-ended', false],
  ['', false],
]

for (const [type, expected] of cases) {
  void test(`isSnapshotMessage(${JSON.stringify(type)}) → ${expected}`, () => {
    assert.equal(isSnapshotMessage(type), expected)
  })
}

// ── Manager snapshot identity ────────────────────────────────────────────────
void test('managerViewForIdentity hides state received under another session or passcode', () => {
  const a = managerSessionIdentity('s1', 'pass-1')
  const snapshot = { phase: 'registration' } as unknown as Parameters<typeof managerViewForIdentity>[0]['snapshot']
  const state = { identity: a, snapshot, authError: 'refused' }
  assert.deepEqual(managerViewForIdentity(state, a), { snapshot, authError: 'refused' }, 'same identity')
  assert.deepEqual(managerViewForIdentity(state, managerSessionIdentity('s2', 'pass-1')), { snapshot: null, authError: null }, 'session changed')
  assert.deepEqual(managerViewForIdentity(state, managerSessionIdentity('s1', 'pass-2')), { snapshot: null, authError: null }, 'passcode changed')
  assert.deepEqual(managerViewForIdentity(state, managerSessionIdentity('s1', null)), { snapshot: null, authError: null }, 'passcode missing')
})

void test('managerSessionIdentity does not collide across field boundaries', () => {
  assert.notEqual(managerSessionIdentity('a:b', 'c'), managerSessionIdentity('a', 'b:c'))
  assert.notEqual(managerSessionIdentity(undefined, null), managerSessionIdentity('', null))
})

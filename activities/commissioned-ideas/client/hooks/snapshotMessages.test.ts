import test from 'node:test'
import assert from 'node:assert/strict'
import { isSnapshotMessage } from './useCommissionedIdeasSession.js'

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

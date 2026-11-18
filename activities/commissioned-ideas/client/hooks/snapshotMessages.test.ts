import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isParticipantAuthRefusal,
  isSnapshotMessage,
  managerSessionIdentity,
  managerViewForIdentity,
  studentSnapshotForAttempt,
  type StudentSnapshot,
} from './useCommissionedIdeasSession.js'

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

// ── Participant auth refusal ─────────────────────────────────────────────────
// Only the explicit refusal code triggers re-registration; load and transport
// errors must keep the stored credential.
const refusalCases: [string, { type?: unknown; code?: unknown }, boolean][] = [
  ['explicit refusal', { type: 'commissioned-ideas:error', code: 'participant-auth-refused' }, true],
  ['generic error without code', { type: 'commissioned-ideas:error' }, false],
  ['session load failure', { type: 'commissioned-ideas:error', code: 'session-not-found' }, false],
  ['refusal code on a snapshot', { type: 'commissioned-ideas:session-state', code: 'participant-auth-refused' }, false],
]

for (const [name, msg, expected] of refusalCases) {
  void test(`isParticipantAuthRefusal: ${name}`, () => {
    assert.equal(isParticipantAuthRefusal(msg), expected)
  })
}

// ── Student snapshot scoped to the registration attempt ──────────────────────
void test('studentSnapshotForAttempt renders only authenticated snapshots from the current attempt', () => {
  const snap = (viewerParticipantId: string | null) => ({ viewerParticipantId } as unknown as StudentSnapshot)
  assert.equal(studentSnapshotForAttempt(null, 'p1'), null, 'nothing received yet')
  assert.equal(studentSnapshotForAttempt({ forId: 'p1', snapshot: snap('p1') }, 'p1')?.viewerParticipantId, 'p1')
  assert.equal(studentSnapshotForAttempt({ forId: 'old', snapshot: snap('old') }, 'new'), null, 'previous registration hidden')
  assert.equal(studentSnapshotForAttempt({ forId: 'p1', snapshot: snap(null) }, 'p1'), null, 'anonymous refusal snapshot never rendered')
  assert.equal(
    studentSnapshotForAttempt({ forId: 'p1', snapshot: snap('p2') }, 'p1')?.viewerParticipantId,
    'p2',
    'the server-bound viewer wins over the stored id',
  )
})

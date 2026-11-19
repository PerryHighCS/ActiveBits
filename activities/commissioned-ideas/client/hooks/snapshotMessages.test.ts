import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isParticipantAuthRefusal,
  isSnapshotMessage,
  managerSessionIdentity,
  managerViewForIdentity,
  acceptStudentSnapshot,
  isSnapshotPayload,
  studentView,
  type ReceivedStudentSnapshot,
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

// ── Student snapshot: pinned identity, connection scope, ordering ─────────────
const snap = (viewerParticipantId: string | null, revision = 1) => ({ viewerParticipantId, revision } as unknown as StudentSnapshot)
const recv = (forId: string | null, connection: number, snapshot: StudentSnapshot): ReceivedStudentSnapshot => ({ forId, connection, snapshot })

const viewCases: [string, ReceivedStudentSnapshot | null, string | null, number, { shown: boolean; identityChanged: boolean }][] = [
  ['nothing received yet', null, 'p1', 1, { shown: false, identityChanged: false }],
  ['authenticated as the pinned participant', recv('p1', 1, snap('p1')), 'p1', 1, { shown: true, identityChanged: false }],
  ['previous registration attempt', recv('old', 1, snap('old')), 'new', 1, { shown: false, identityChanged: false }],
  ['previous connection (reconnecting)', recv('p1', 1, snap('p1')), 'p1', 2, { shown: false, identityChanged: false }],
  ['anonymous refusal snapshot', recv('p1', 1, snap(null)), 'p1', 1, { shown: false, identityChanged: false }],
  ['reconnect authenticated as someone else', recv('p1', 2, snap('p2')), 'p1', 2, { shown: false, identityChanged: true }],
]

for (const [name, received, participantId, connection, expected] of viewCases) {
  void test(`studentView: ${name}`, () => {
    const view = studentView(received, participantId, connection)
    assert.equal(view.snapshot !== null, expected.shown)
    assert.equal(view.identityChanged, expected.identityChanged)
  })
}

void test('acceptStudentSnapshot drops older revisions on the same connection only', () => {
  const current = recv('p1', 1, snap('p1', 5))
  assert.equal(acceptStudentSnapshot(current, recv('p1', 1, snap('p1', 4))), current, 'older on the same connection: dropped')
  assert.equal(acceptStudentSnapshot(current, recv('p1', 1, snap('p1', 5))).snapshot.revision, 5, 'same revision: accepted')
  assert.equal(acceptStudentSnapshot(current, recv('p1', 1, snap('p1', 6))).snapshot.revision, 6)
  assert.equal(acceptStudentSnapshot(current, recv('p1', 2, snap('p1', 3))).connection, 2, 'a new connection replaces it')
})

void test('isSnapshotPayload rejects malformed payloads', () => {
  for (const bad of [null, undefined, 'x', 3, [], {}, { revision: '1' }]) assert.equal(isSnapshotPayload(bad), false, JSON.stringify(bad))
  assert.equal(isSnapshotPayload({ revision: 0 }), true)
})

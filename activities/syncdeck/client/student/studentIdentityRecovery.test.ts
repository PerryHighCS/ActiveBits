import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyncDeckStudentIdentityApiUrl,
  fetchAcceptedSyncDeckStudentIdentity,
  lookupAcceptedSyncDeckStudentIdentity,
  reconcileStoredSyncDeckStudentIdentity,
  resolveRecoveredSyncDeckStudentIdentity,
} from './studentIdentityRecovery'

function jsonResponse(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body }
}

void test('fetchAcceptedSyncDeckStudentIdentity reads the cookie-proven student with credentials and no caching', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const identity = await fetchAcceptedSyncDeckStudentIdentity('s 1', async (url, init) => {
    calls.push({ url, init })
    return jsonResponse(true, { studentId: ' student-1 ', displayName: ' Ada ' })
  })
  assert.deepEqual(identity, { studentId: 'student-1', studentName: 'Ada' })
  assert.equal(calls[0]?.url, buildSyncDeckStudentIdentityApiUrl('s 1'))
  assert.equal(calls[0]?.url, '/api/syncdeck/s%201/student-identity')
  assert.equal(calls[0]?.init?.credentials, 'include')
  assert.equal(calls[0]?.init?.cache, 'no-store')
})

void test('fetchAcceptedSyncDeckStudentIdentity calls fetch without a receiver', async () => {
  const receivers: unknown[] = []
  await fetchAcceptedSyncDeckStudentIdentity('s1', function (this: unknown) {
    // Native fetch rejects any receiver other than the window ("Illegal invocation").
    receivers.push(this)
    return Promise.resolve(jsonResponse(true, { studentId: 'student-1', displayName: 'Ada' }))
  })
  assert.deepEqual(receivers, [undefined])
})

void test('fetchAcceptedSyncDeckStudentIdentity returns null for denied, malformed, or failed requests', async () => {
  console.info('[TEST] Expected student identity lookup failures.')
  assert.equal(await fetchAcceptedSyncDeckStudentIdentity('s1', async () => jsonResponse(false, { error: 'forbidden' })), null)
  assert.equal(await fetchAcceptedSyncDeckStudentIdentity('s1', async () => jsonResponse(true, { studentId: '  ' })), null)
  assert.equal(await fetchAcceptedSyncDeckStudentIdentity('s1', async () => jsonResponse(true, null)), null)
  assert.equal(await fetchAcceptedSyncDeckStudentIdentity('s1', async () => { throw new Error('[TEST] network down') }), null)
  assert.equal(await fetchAcceptedSyncDeckStudentIdentity('s1', null), null)
})

void test('resolveRecoveredSyncDeckStudentIdentity adopts only a complete identity other than the rejected one', () => {
  const ada = { studentId: 'student-1', studentName: 'Ada' }
  // Decision table: recovered identity x rejected ID.
  assert.deepEqual(resolveRecoveredSyncDeckStudentIdentity(ada, null), ada)
  assert.deepEqual(resolveRecoveredSyncDeckStudentIdentity(ada, 'stale-id'), ada)
  assert.equal(resolveRecoveredSyncDeckStudentIdentity(ada, 'student-1'), null)
  assert.equal(resolveRecoveredSyncDeckStudentIdentity({ studentId: 'student-1', studentName: '' }, null), null)
  assert.equal(resolveRecoveredSyncDeckStudentIdentity(null, null), null)
  assert.equal(resolveRecoveredSyncDeckStudentIdentity(null, 'stale-id'), null)
})

void test('lookupAcceptedSyncDeckStudentIdentity distinguishes a denied cookie from an unknown answer', async () => {
  console.info('[TEST] Expected student identity lookup denials and failures.')
  assert.deepEqual(
    await lookupAcceptedSyncDeckStudentIdentity('s1', async () => jsonResponse(true, { studentId: 'student-1', displayName: 'Ada' })),
    { status: 'ok', identity: { studentId: 'student-1', studentName: 'Ada' } },
  )
  assert.deepEqual(await lookupAcceptedSyncDeckStudentIdentity('s1', async () => jsonResponse(false, { error: 'forbidden' }, 403)), { status: 'denied' })
  assert.deepEqual(await lookupAcceptedSyncDeckStudentIdentity('s1', async () => jsonResponse(false, { error: 'invalid session' }, 404)), { status: 'unavailable' })
  assert.deepEqual(await lookupAcceptedSyncDeckStudentIdentity('s1', async () => jsonResponse(false, {}, 500)), { status: 'unavailable' })
  assert.deepEqual(await lookupAcceptedSyncDeckStudentIdentity('s1', async () => { throw new Error('[TEST] network down') }), { status: 'unavailable' })
  assert.deepEqual(await lookupAcceptedSyncDeckStudentIdentity('s1', null), { status: 'unavailable' })
})

void test('reconcileStoredSyncDeckStudentIdentity lets the cookie win and clears a denied cache', () => {
  const stored = { studentId: 'stale-student', studentName: 'Ada' }
  const cookie = { studentId: 'student-1', studentName: 'Ada L.' }
  // Decision table: stored identity (present/absent) x lookup result.
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity(stored, { status: 'ok', identity: cookie }), { action: 'adopt', identity: cookie })
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity(null, { status: 'ok', identity: cookie }), { action: 'adopt', identity: cookie })
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity(stored, { status: 'denied' }), { action: 'clear' })
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity(null, { status: 'denied' }), { action: 'clear' })
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity(stored, { status: 'unavailable' }), { action: 'keep' })
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity(null, { status: 'unavailable' }), { action: 'clear' })
  // A cookie identity without a display name keeps only a matching stored identity.
  const nameless = { status: 'ok' as const, identity: { studentId: 'student-1', studentName: '' } }
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity({ studentId: 'student-1', studentName: 'Ada' }, nameless), { action: 'keep' })
  assert.deepEqual(reconcileStoredSyncDeckStudentIdentity(stored, nameless), { action: 'clear' })
})

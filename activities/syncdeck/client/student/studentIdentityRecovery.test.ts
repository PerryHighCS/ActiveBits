import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyncDeckStudentIdentityApiUrl,
  fetchAcceptedSyncDeckStudentIdentity,
  resolveRecoveredSyncDeckStudentIdentity,
} from './studentIdentityRecovery'

function jsonResponse(ok: boolean, body: unknown) {
  return { ok, json: async () => body }
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

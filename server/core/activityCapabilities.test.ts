import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ACTIVITY_CAPABILITY_TTL_MS,
  getActivityCapabilityCookieName,
  issueActivityCapability,
  readCookieValue,
  resolveActivityCapability,
  resolveActivityPrincipalFromCookies,
} from './activityCapabilities.js'

void test('activity capabilities retain only a hash and resolve in their session and role', () => {
  const session = { data: {} as Record<string, unknown> }
  const issued = issueActivityCapability(session, 'manager')
  const stored = (session.data.activityCapabilities as Record<string, { tokenHash: string }>)[issued.id]

  assert.ok(stored)
  assert.notEqual(stored.tokenHash, issued.token)
  assert.deepEqual(resolveActivityCapability(session, 'session-a', 'manager', issued.token), {
    kind: 'manager', sessionId: 'session-a', capabilityId: issued.id,
  })
  assert.equal(resolveActivityCapability(session, 'session-a', 'participant', issued.token), null)
  assert.equal(resolveActivityCapability({ data: {} }, 'session-b', 'manager', issued.token), null)
})

void test('activity capability cookie resolution is session-scoped and parses websocket headers', () => {
  const session = { data: {} as Record<string, unknown> }
  const issued = issueActivityCapability(session, 'participant', 'student-1')
  const name = getActivityCapabilityCookieName('participant', 'session-a')

  assert.equal(readCookieValue(`other=x; ${name}=${issued.token}`, name), issued.token)
  assert.deepEqual(resolveActivityPrincipalFromCookies(session, 'session-a', 'participant', { [name]: issued.token }), {
    kind: 'participant', sessionId: 'session-a', capabilityId: issued.id, subjectId: 'student-1',
  })
  assert.equal(resolveActivityPrincipalFromCookies(session, 'session-b', 'participant', { [name]: issued.token }), null)
})

void test('activity capabilities have a bounded lifetime and are rejected once expired', () => {
  const session = { data: {} as Record<string, unknown> }
  const issuedAt = 1_000
  const issued = issueActivityCapability(session, 'manager', undefined, issuedAt, 60_000)

  // Just before expiry the capability still resolves.
  assert.deepEqual(resolveActivityCapability(session, 'session-a', 'manager', issued.token, issuedAt + 59_999), {
    kind: 'manager', sessionId: 'session-a', capabilityId: issued.id,
  })
  // At and after expiry it is rejected.
  assert.equal(resolveActivityCapability(session, 'session-a', 'manager', issued.token, issuedAt + 60_000), null)
  assert.equal(resolveActivityCapability(session, 'session-a', 'manager', issued.token, issuedAt + 3_600_000), null)

  const stored = (session.data.activityCapabilities as Record<string, { expiresAt: number }>)[issued.id]
  assert.equal(stored?.expiresAt, issuedAt + 60_000)

  const defaulted = issueActivityCapability(session, 'manager', undefined, issuedAt)
  const defaultRecord = (session.data.activityCapabilities as Record<string, { expiresAt: number }>)[defaulted.id]
  assert.equal(defaultRecord?.expiresAt, issuedAt + DEFAULT_ACTIVITY_CAPABILITY_TTL_MS)
})

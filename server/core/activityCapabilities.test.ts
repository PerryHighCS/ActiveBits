import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getActivityCapabilityCookieName,
  issueActivityCapability,
  readCookieValue,
  resolveActivityCapability,
  resolveActivityPrincipalFromCookies,
} from './activityCapabilities.js'

void test('activity capabilities retain only a hash and resolve in their session and role', () => {
  const session = { data: {} as Record<string, unknown> }
  const issued = issueActivityCapability(session, 'manager', undefined, 123)
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

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ACTIVITY_CAPABILITY_TTL_MS,
  getActivityCapabilityCookieName,
  issueActivityCapability,
  readCookieValue,
  resolveActivityCapability,
  resolveActivityPrincipalFromCookies,
  revokeActivityCapabilitiesForSubject,
  tryIssueActivityCapability,
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

  // A non-finite ttl falls back to the default rather than storing NaN.
  const badTtl = issueActivityCapability(session, 'manager', undefined, issuedAt, Number.NaN)
  const badTtlRecord = (session.data.activityCapabilities as Record<string, { expiresAt: number }>)[badTtl.id]
  assert.equal(badTtlRecord?.expiresAt, issuedAt + DEFAULT_ACTIVITY_CAPABILITY_TTL_MS)

  // A stored record whose expiry was lost or corrupted is not a valid principal.
  console.info('[TEST] activity capability resolution: a stored record with no expiresAt is expected to be rejected')
  const caps = session.data.activityCapabilities as Record<string, { expiresAt?: number; issuedAt?: number }>
  delete caps[issued.id]!.expiresAt
  assert.equal(resolveActivityCapability(session, 'session-a', 'manager', issued.token, issuedAt + 1), null)
})

void test('a stored capability with no issuedAt is rejected rather than treated as usable', () => {
  console.info('[TEST] activity capability resolution: a stored record with no issuedAt is expected to be rejected')
  const session = { data: {} as Record<string, unknown> }
  const issuedAt = 1_000
  const issued = issueActivityCapability(session, 'participant', 'student-1', issuedAt, 60_000)

  const caps = session.data.activityCapabilities as Record<string, { issuedAt?: number }>
  delete caps[issued.id]!.issuedAt

  // A record missing issuedAt must not resolve as a valid principal...
  assert.equal(resolveActivityCapability(session, 'session-a', 'participant', issued.token, issuedAt + 1), null)

  // ...nor be treated as usable capacity by the bounded, non-evicting issuance path.
  const reissued = tryIssueActivityCapability(session, 'participant', 'student-2', issuedAt + 1, 60_000)
  assert.ok(reissued)
  assert.equal(Object.keys(session.data.activityCapabilities as Record<string, unknown>).length, 1)
})

void test('non-evicting capability issuance preserves live principals at capacity', () => {
  const session = { data: {} as Record<string, unknown> }
  const first = issueActivityCapability(session, 'participant', 'student-0', 1_000)
  for (let index = 1; index < 200; index += 1) {
    issueActivityCapability(session, 'participant', `student-${index}`, 1_000)
  }

  assert.equal(tryIssueActivityCapability(session, 'participant', 'student-200', 2_000), null)
  assert.ok(resolveActivityCapability(session, 'session-a', 'participant', first.token, 2_000))
})

void test('non-evicting capability issuance removes invalid records before capacity checks', () => {
  const session = { data: {
    activityCapabilities: Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`invalid-${index}`, { id: `invalid-${index}` }]),
    ),
  } as Record<string, unknown> }

  const issued = tryIssueActivityCapability(session, 'participant', 'student-1', 1_000)
  assert.ok(issued)
  const capabilities = session.data.activityCapabilities as Record<string, unknown>
  assert.deepEqual(Object.keys(capabilities), [issued.id])
})

void test('revokeActivityCapabilitiesForSubject revokes only that subject\'s capabilities of that kind', () => {
  const session = { data: {} as Record<string, unknown> }
  const ada = issueActivityCapability(session, 'participant', 'student-1')
  const adaSecond = issueActivityCapability(session, 'participant', 'student-1')
  const lin = issueActivityCapability(session, 'participant', 'student-2')
  const adaManager = issueActivityCapability(session, 'manager', 'student-1')
  const anonymousManager = issueActivityCapability(session, 'manager')

  assert.equal(revokeActivityCapabilitiesForSubject(session, 'participant', 'student-1'), 2)
  assert.equal(resolveActivityCapability(session, 's', 'participant', ada.token), null)
  assert.equal(resolveActivityCapability(session, 's', 'participant', adaSecond.token), null)
  assert.notEqual(resolveActivityCapability(session, 's', 'participant', lin.token), null)
  assert.notEqual(resolveActivityCapability(session, 's', 'manager', adaManager.token), null)
  assert.notEqual(resolveActivityCapability(session, 's', 'manager', anonymousManager.token), null)

  // Unknown subjects and sessions without capabilities revoke nothing.
  assert.equal(revokeActivityCapabilitiesForSubject(session, 'participant', 'missing'), 0)
  assert.equal(revokeActivityCapabilitiesForSubject({ data: {} }, 'participant', 'student-1'), 0)
  assert.equal(revokeActivityCapabilitiesForSubject({ data: null }, 'participant', 'student-1'), 0)
})

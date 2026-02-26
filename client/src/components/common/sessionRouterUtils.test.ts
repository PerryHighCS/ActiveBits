import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTeacherManagePathFromSession,
  buildPersistentTeacherManagePath,
  buildPersistentSessionApiUrl,
  cleanExpiredSessions,
  getPersistentSelectedOptionsFromSearch,
  getPersistentQuerySuffix,
  getSessionPresentationUrlForTeacherRedirect,
  getSoloActivities,
  isJoinSessionId,
  readCachedSession,
} from './sessionRouterUtils'

interface MockStorage {
  length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function createMockStorage(initial: Record<string, string>): MockStorage {
  const data = new Map(Object.entries(initial))

  return {
    get length() {
      return data.size
    },
    key(index: number): string | null {
      const entries = [...data.keys()]
      return entries[index] ?? null
    },
    getItem(key: string): string | null {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      data.set(key, value)
    },
    removeItem(key: string): void {
      data.delete(key)
    },
  }
}

void test('cleanExpiredSessions removes stale and malformed session-* entries only', () => {
  const now = 2_000
  const logs: string[] = []
  const storage = createMockStorage({
    'session-valid': JSON.stringify({ timestamp: now - 100 }),
    'session-expired': JSON.stringify({ timestamp: now - 50_000 }),
    'session-invalid': 'not-json',
    other: JSON.stringify({ timestamp: 1 }),
  })

  cleanExpiredSessions(storage, now, 1_000, (message) => logs.push(message))

  assert.equal(storage.getItem('session-valid') !== null, true)
  assert.equal(storage.getItem('session-expired'), null)
  assert.equal(storage.getItem('session-invalid'), null)
  assert.equal(storage.getItem('other') !== null, true)
  assert.ok(logs.some((entry) => entry.includes('Expiring session-expired')))
  assert.ok(logs.some((entry) => entry.includes('Removing invalid entry session-invalid')))
})

void test('readCachedSession returns valid entries and clears invalid/expired values', () => {
  const now = 10_000
  const logs: string[] = []
  const storage = createMockStorage({
    'session-valid': JSON.stringify({ timestamp: now - 200, type: 'raffle' }),
    'session-expired': JSON.stringify({ timestamp: now - 5_000 }),
    'session-invalid': '{',
  })

  const valid = readCachedSession(storage, 'session-valid', now, 1_000, (message) => logs.push(message))
  const expired = readCachedSession(storage, 'session-expired', now, 1_000, (message) => logs.push(message))
  const invalid = readCachedSession(storage, 'session-invalid', now, 1_000, (message) => logs.push(message))

  assert.equal(valid?.type, 'raffle')
  assert.equal(expired, null)
  assert.equal(invalid, null)
  assert.equal(storage.getItem('session-expired'), null)
  assert.equal(storage.getItem('session-invalid'), null)
  assert.ok(logs.some((entry) => entry.includes('removing session-expired')))
  assert.ok(logs.some((entry) => entry.includes('removing invalid session-invalid')))
})

void test('getPersistentQuerySuffix preserves query params for persistent-session fetches', () => {
  assert.equal(getPersistentQuerySuffix('?algorithm=merge-sort'), '&algorithm=merge-sort')
  assert.equal(getPersistentQuerySuffix(''), '')
})

void test('buildPersistentSessionApiUrl encodes hash and activityName and preserves search params', () => {
  const url = buildPersistentSessionApiUrl('abc/123?x y', 'merge&sort', '?algorithm=quick sort&debug=true')
  assert.equal(
    url,
    '/api/persistent-session/abc%2F123%3Fx%20y?algorithm=quick+sort&debug=true&activityName=merge%26sort',
  )
})

void test('buildPersistentSessionApiUrl replaces existing activityName in search', () => {
  const url = buildPersistentSessionApiUrl('abc123', 'new-name', '?activityName=old&mode=solo')
  assert.equal(url, '/api/persistent-session/abc123?activityName=new-name&mode=solo')
})

void test('buildPersistentTeacherManagePath drops permalink query for started syncdeck sessions', () => {
  const path = buildPersistentTeacherManagePath(
    'syncdeck',
    'session-123',
    '?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck&urlHash=abcd1234',
  )

  assert.equal(path, '/manage/syncdeck/session-123')
})

void test('buildPersistentTeacherManagePath preserves query for non-syncdeck activities', () => {
  const path = buildPersistentTeacherManagePath('raffle', 'session-123', '?foo=bar')
  assert.equal(path, '/manage/raffle/session-123?foo=bar')
})

void test('getSessionPresentationUrlForTeacherRedirect returns validated session presentationUrl', () => {
  assert.equal(
    getSessionPresentationUrlForTeacherRedirect({
      data: { presentationUrl: ' https://slides.example/deck ' },
    }),
    'https://slides.example/deck',
  )
  assert.equal(
    getSessionPresentationUrlForTeacherRedirect({
      data: { presentationUrl: 'javascript:alert(1)' },
    }),
    null,
  )
})

void test('buildTeacherManagePathFromSession uses session presentationUrl for syncdeck redirects', () => {
  const path = buildTeacherManagePathFromSession(
    'syncdeck',
    'session-123',
    '?presentationUrl=https%3A%2F%2Fwrong.example%2Fdeck&urlHash=abcd',
    'https://slides.example/deck',
  )
  assert.equal(path, '/manage/syncdeck/session-123?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck')
})

void test('buildTeacherManagePathFromSession falls back for non-syncdeck or missing session url', () => {
  assert.equal(
    buildTeacherManagePathFromSession('syncdeck', 'session-123', '?foo=bar', null),
    '/manage/syncdeck/session-123',
  )
  assert.equal(
    buildTeacherManagePathFromSession('raffle', 'session-123', '?foo=bar', 'https://slides.example/deck'),
    '/manage/raffle/session-123?foo=bar',
  )
})

void test('getPersistentSelectedOptionsFromSearch filters query params by deepLinkOptions', () => {
  const selectedOptions = getPersistentSelectedOptionsFromSearch(
    '?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck&utm_source=email&mode=review&empty=',
    {
      presentationUrl: { type: 'text', validator: 'url' },
      mode: { type: 'select' },
      empty: { type: 'text' },
    },
  )

  assert.deepEqual(selectedOptions, {
    presentationUrl: 'https://slides.example/deck',
    mode: 'review',
  })
})

void test('getPersistentSelectedOptionsFromSearch returns empty object when no deepLinkOptions exist', () => {
  const selectedOptions = getPersistentSelectedOptionsFromSearch('?utm_source=email&debug=true', undefined)
  assert.deepEqual(selectedOptions, {})
})

void test('isJoinSessionId requires a full non-zero hex string', () => {
  assert.equal(isJoinSessionId('abc123'), true)
  assert.equal(isJoinSessionId('  AbC123  '), true)
  assert.equal(isJoinSessionId('abc123xyz'), false)
  assert.equal(isJoinSessionId('0xabc123'), false)
  assert.equal(isJoinSessionId('0'), false)
  assert.equal(isJoinSessionId('0000'), false)
  assert.equal(isJoinSessionId(''), false)
})

void test('getSoloActivities filters activity list to solo-mode entries', () => {
  const result = getSoloActivities([
    { id: 'a', name: 'A', description: 'A', color: 'blue', soloMode: true },
    { id: 'b', name: 'B', description: 'B', color: 'green', soloMode: false },
  ])

  assert.deepEqual(result.map((activity) => activity.id), ['a'])
})

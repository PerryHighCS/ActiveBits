import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boundPersistentSessionCookieEntries,
  getPersistentSessionCookieValueByteLength,
  MAX_PERSISTENT_SESSIONS_COOKIE_BYTES,
  MAX_PERSISTENT_SESSIONS_PER_COOKIE,
} from './persistentSessionCookie.js'

void test('persistent instructor cookie bounds entries by count and serialized byte size', () => {
  const entries = Array.from({ length: MAX_PERSISTENT_SESSIONS_PER_COOKIE + 4 }, (_, index) => ({
    key: `syncdeck:${index}`,
    teacherCode: `teacher-${index}`,
    selectedOptions: { presentationUrl: `https://slides.example/${index}/${'x'.repeat(300)}` },
  }))

  const bounded = boundPersistentSessionCookieEntries(entries)

  assert.ok(bounded.length <= MAX_PERSISTENT_SESSIONS_PER_COOKIE)
  assert.ok(getPersistentSessionCookieValueByteLength(bounded) <= MAX_PERSISTENT_SESSIONS_COOKIE_BYTES)
  assert.equal(bounded.at(-1)?.key, entries.at(-1)?.key)
})

void test('persistent instructor cookie retains the newest entries when only the count limit applies', () => {
  const entries = Array.from({ length: MAX_PERSISTENT_SESSIONS_PER_COOKIE + 2 }, (_, index) => ({
    key: `activity:${index}`,
  }))

  const bounded = boundPersistentSessionCookieEntries(entries)

  assert.equal(bounded.length, MAX_PERSISTENT_SESSIONS_PER_COOKIE)
  assert.equal(bounded[0]?.key, entries[2]?.key)
  assert.equal(bounded.at(-1)?.key, entries.at(-1)?.key)
})

void test('persistent instructor cookie omits a singleton that exceeds the encoded byte limit', () => {
  const bounded = boundPersistentSessionCookieEntries([{
    key: 'syncdeck:oversized',
    teacherCode: 'é'.repeat(MAX_PERSISTENT_SESSIONS_COOKIE_BYTES),
  }])

  assert.deepEqual(bounded, [])
  assert.ok(getPersistentSessionCookieValueByteLength(bounded) <= MAX_PERSISTENT_SESSIONS_COOKIE_BYTES)
})

void test('persistent instructor cookie skips an oversized newest entry without dropping older valid entries', () => {
  const bounded = boundPersistentSessionCookieEntries([
    { key: 'syncdeck:older-one', teacherCode: 'teacher-one' },
    { key: 'syncdeck:older-two', teacherCode: 'teacher-two' },
    { key: 'syncdeck:oversized', teacherCode: 'é'.repeat(MAX_PERSISTENT_SESSIONS_COOKIE_BYTES) },
  ])

  assert.deepEqual(bounded, [
    { key: 'syncdeck:older-one', teacherCode: 'teacher-one' },
    { key: 'syncdeck:older-two', teacherCode: 'teacher-two' },
  ])
})

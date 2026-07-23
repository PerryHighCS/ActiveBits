import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boundPersistentSessionCookieEntries,
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
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= MAX_PERSISTENT_SESSIONS_COOKIE_BYTES)
  assert.equal(bounded.at(-1)?.key, entries.at(-1)?.key)
})

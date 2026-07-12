import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchEmbeddedManagerPasscode } from './useEmbeddedManagerPasscodeExchange'

void test('fetchEmbeddedManagerPasscode requests a no-store same-origin token exchange', async () => {
  let request: { input: string; init: RequestInit } | null = null
  const passcode = await fetchEmbeddedManagerPasscode({
    sessionId: 'child session',
    token: 'token/value',
    fetchImpl: async (input, init) => {
      request = { input, init }
      return { ok: true, json: async () => ({ instructorPasscode: ' teacher-pass ' }) }
    },
  })

  assert.equal(passcode, 'teacher-pass')
  assert.deepEqual(request, {
    input: '/api/syncdeck/embedded-manager-passcode?sessionId=child%20session&token=token%2Fvalue',
    init: { credentials: 'same-origin', cache: 'no-store' },
  })
})

void test('fetchEmbeddedManagerPasscode rejects invalid exchange responses without a passcode', async () => {
  assert.equal(
    await fetchEmbeddedManagerPasscode({
      sessionId: 'child',
      token: 'token',
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    }),
    null,
  )
  assert.equal(
    await fetchEmbeddedManagerPasscode({
      sessionId: 'child',
      token: 'token',
      fetchImpl: async () => ({ ok: true, json: async () => ({ instructorPasscode: '   ' }) }),
    }),
    null,
  )
})

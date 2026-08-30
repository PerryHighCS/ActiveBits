import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EmbeddedManagerPasscodeExchangeUnavailableError,
} from './useEmbeddedManagerPasscodeExchange'
import { fetchEmbeddedManagerCapability } from './useEmbeddedManagerCapabilityExchange'

void test('fetchEmbeddedManagerCapability requests the cookie-only no-store exchange', async () => {
  let request: { input: string; init: RequestInit } | null = null
  const authorized = await fetchEmbeddedManagerCapability({
    sessionId: 'child session',
    token: 'token/value',
    fetchImpl: async (input, init) => {
      request = { input, init }
      return { ok: true }
    },
  })

  assert.equal(authorized, true)
  assert.deepEqual(request, {
    input: '/api/syncdeck/embedded-manager-capability?sessionId=child%20session&token=token%2Fvalue',
    init: { credentials: 'same-origin', cache: 'no-store' },
  })
})

void test('fetchEmbeddedManagerCapability distinguishes invalid and temporary failures', async () => {
  assert.equal(await fetchEmbeddedManagerCapability({
    sessionId: 'child', token: 'invalid', fetchImpl: async () => ({ ok: false, status: 403 }),
  }), false)
  console.info('[TEST] Expected embedded-manager capability exchange server failure.')
  await assert.rejects(
    fetchEmbeddedManagerCapability({
      sessionId: 'child', token: 'retry', fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    (error: unknown) => error instanceof EmbeddedManagerPasscodeExchangeUnavailableError,
  )
})

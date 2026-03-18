import assert from 'node:assert/strict'
import test from 'node:test'
import syncdeckClientModule, { launchSyncDeckPersistentSoloEntry } from './index.js'

void test('syncdeck client module exports deep-link preflight runner for dashboard validation', async () => {
  assert.equal(typeof syncdeckClientModule.runDeepLinkPreflight, 'function')

  const result = await syncdeckClientModule.runDeepLinkPreflight?.(
    {
      type: 'reveal-sync-ping',
      optionKey: 'presentationUrl',
      timeoutMs: 25,
    },
    'https://slides.example.com/deck',
  )

  assert.deepEqual(result, {
    valid: false,
    warning: 'Presentation validation is unavailable in this environment.',
  })
})

void test('launchSyncDeckPersistentSoloEntry creates and configures a solo session from permalink options', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ input: string; init?: RequestInit }> = []

  globalThis.fetch = (async (input, init) => {
    requests.push({ input: String(input), init })

    if (String(input) === '/api/syncdeck/create') {
      return {
        ok: true,
        json: async () => ({
          id: 'syncdeck-solo-1',
          instructorPasscode: 'pass-123',
        }),
      } as Response
    }

    if (String(input) === '/api/syncdeck/syncdeck-solo-1/configure') {
      return {
        ok: true,
        json: async () => ({}),
      } as Response
    }

    throw new Error(`Unexpected fetch: ${String(input)}`)
  }) as typeof fetch

  try {
    const result = await launchSyncDeckPersistentSoloEntry({
      hash: 'hash-1',
      search: '?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck',
      selectedOptions: {
        presentationUrl: 'https://slides.example/deck',
        urlHash: 'should-not-be-forwarded',
      },
    })

    assert.deepEqual(result, {
      sessionId: 'syncdeck-solo-1',
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0]?.input, '/api/syncdeck/create')
    assert.equal(requests[1]?.input, '/api/syncdeck/syncdeck-solo-1/configure')
    assert.deepEqual(
      JSON.parse(String(requests[1]?.init?.body ?? '{}')),
      {
        presentationUrl: 'https://slides.example/deck',
        instructorPasscode: 'pass-123',
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('launchSyncDeckPersistentSoloEntry rejects permalink launches without a presentation URL', async () => {
  await assert.rejects(
    launchSyncDeckPersistentSoloEntry({
      hash: 'hash-1',
      search: '',
      selectedOptions: {},
    }),
    /missing a presentation URL/i,
  )
})

void test('syncdeck client module exports persistent solo launcher', () => {
  assert.equal(typeof syncdeckClientModule.launchPersistentSoloEntry, 'function')
})

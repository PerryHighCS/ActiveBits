import assert from 'node:assert/strict'
import test from 'node:test'
import { launchVideoSyncPersistentSoloEntry } from './index.js'

void test('launchVideoSyncPersistentSoloEntry creates and configures a standalone solo session', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ input: url, init })

    if (url === '/api/video-sync/create') {
      return new Response(JSON.stringify({
        id: 'session-123',
        instructorPasscode: 'pass-123',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url === '/api/video-sync/session-123/session') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    throw new Error(`[TEST] Unexpected fetch call: ${url}`)
  }) as typeof fetch

  try {
    const result = await launchVideoSyncPersistentSoloEntry({
      selectedOptions: {
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      },
    })

    assert.deepEqual(result, { sessionId: 'session-123' })
    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.input, '/api/video-sync/create')
    assert.equal(calls[0]?.init?.method, 'POST')
    assert.equal(calls[1]?.input, '/api/video-sync/session-123/session')
    assert.equal(calls[1]?.init?.method, 'PATCH')
    assert.deepEqual(
      JSON.parse(String(calls[1]?.init?.body)),
      {
        instructorPasscode: 'pass-123',
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
        standaloneMode: true,
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('launchVideoSyncPersistentSoloEntry rejects when sourceUrl is missing', async () => {
  await assert.rejects(
    async () => {
      await launchVideoSyncPersistentSoloEntry({
        selectedOptions: {},
      })
    },
    /requires a configured YouTube URL/i,
  )
})

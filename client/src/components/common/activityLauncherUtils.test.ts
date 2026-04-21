import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildStandaloneActivityLauncherManagePath,
  createStandaloneActivitySession,
  getStandaloneActivityLauncherRequestedOptions,
  isStandaloneActivityLauncherAutoStart,
  resolveStandaloneActivityLauncherOptions,
} from './activityLauncherUtils.js'

const deepLinkOptions = {
  sourceUrl: {
    label: 'YouTube URL',
    type: 'text',
    validator: 'url',
  },
  mode: {
    label: 'Mode',
    type: 'select',
    options: [
      { value: 'a', label: 'Mode A' },
      { value: 'b', label: 'Mode B' },
    ],
  },
}

void test('isStandaloneActivityLauncherAutoStart requires start=1', () => {
  assert.equal(isStandaloneActivityLauncherAutoStart('?start=1'), true)
  assert.equal(isStandaloneActivityLauncherAutoStart('?start=true'), false)
  assert.equal(isStandaloneActivityLauncherAutoStart('?sourceUrl=https%3A%2F%2Fexample.com'), false)
})

void test('getStandaloneActivityLauncherRequestedOptions removes launcher control params', () => {
  assert.deepEqual(
    getStandaloneActivityLauncherRequestedOptions('?start=1&sourceUrl=https%3A%2F%2Fexample.com&debug=true'),
    {
      sourceUrl: 'https://example.com',
      debug: 'true',
    },
  )
})

void test('resolveStandaloneActivityLauncherOptions keeps known options and validates supplied urls', () => {
  assert.deepEqual(
    resolveStandaloneActivityLauncherOptions(
      deepLinkOptions,
      '?start=1&sourceUrl=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ&mode=b&ignored=value',
    ),
    {
      selectedOptions: {
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
        mode: 'b',
      },
      errors: [],
    },
  )

  assert.deepEqual(
    resolveStandaloneActivityLauncherOptions(deepLinkOptions, '?sourceUrl=not-a-url'),
    {
      selectedOptions: {
        sourceUrl: 'not-a-url',
      },
      errors: ['YouTube URL must be a valid http(s) URL'],
    },
  )

  assert.deepEqual(resolveStandaloneActivityLauncherOptions(deepLinkOptions, ''), {
    selectedOptions: {},
    errors: [],
  })
})

void test('buildStandaloneActivityLauncherManagePath preserves normalized launch options', () => {
  assert.equal(
    buildStandaloneActivityLauncherManagePath('video-sync', 'session-1', {
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
    }),
    '/manage/video-sync/session-1?sourceUrl=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Ft%3D43',
  )
})

void test('createStandaloneActivitySession posts to activity create endpoint and validates id', async () => {
  const calls: Array<{ input: RequestInfo | URL, init?: RequestInit }> = []
  const fetchImpl = (async (input, init) => {
    calls.push({ input, init })
    return new Response(JSON.stringify({ id: 'session-1', instructorPasscode: 'pass-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) satisfies typeof fetch

  assert.deepEqual(await createStandaloneActivitySession('video-sync', fetchImpl), {
    id: 'session-1',
    instructorPasscode: 'pass-1',
  })
  assert.equal(calls[0]?.input, '/api/video-sync/create')
  assert.equal(calls[0]?.init?.method, 'POST')
})

void test('createStandaloneActivitySession rejects failed or malformed create responses', async () => {
  await assert.rejects(
    createStandaloneActivitySession('video-sync', async () => new Response('{}', { status: 500 })),
    /Failed to create session/,
  )
  await assert.rejects(
    createStandaloneActivitySession('video-sync', async () => new Response('{}', { status: 200 })),
    /Failed to create session/,
  )
})

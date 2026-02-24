import assert from 'node:assert/strict'
import test from 'node:test'
import syncdeckClientModule from './index.js'

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


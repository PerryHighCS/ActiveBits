import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBroadcastMessage, readEmbeddedLaunchAlgorithmId } from './DemoManager.js'

void test('parseBroadcastMessage accepts valid broadcast envelopes', () => {
  const parsed = parseBroadcastMessage(
    JSON.stringify({
      type: 'state-sync',
      algorithmId: 'linear-search',
      payload: { step: 2 },
    }),
  )

  assert.deepEqual(parsed, {
    type: 'state-sync',
    algorithmId: 'linear-search',
    payload: { step: 2 },
  })
})

void test('parseBroadcastMessage rejects malformed payloads', () => {
  assert.equal(parseBroadcastMessage('not-json'), null)
  assert.equal(parseBroadcastMessage(42), null)
})

void test('readEmbeddedLaunchAlgorithmId reads canonical embedded launch state', () => {
  assert.equal(readEmbeddedLaunchAlgorithmId({
    embeddedLaunch: {
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  }), 'merge-sort')

  assert.equal(readEmbeddedLaunchAlgorithmId({
    embeddedLaunch: {
      selectedOptions: {
        algorithm: 42,
      },
    },
  }), null)

  assert.equal(readEmbeddedLaunchAlgorithmId(null), null)
})

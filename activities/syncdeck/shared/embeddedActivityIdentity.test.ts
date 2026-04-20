import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGeneratedEmbeddedActivityInstanceKey,
  parseEmbeddedActivityLocationFromInstanceKey,
  resolveEmbeddedActivityLocation,
} from './embeddedActivityIdentity.js'

void test('parseEmbeddedActivityLocationFromInstanceKey parses strict integer anchors', () => {
  assert.deepEqual(parseEmbeddedActivityLocationFromInstanceKey('raffle:3:1'), { h: 3, v: 1 })
  assert.deepEqual(parseEmbeddedActivityLocationFromInstanceKey('resonance:-1:0'), { h: -1, v: 0 })
  assert.deepEqual(parseEmbeddedActivityLocationFromInstanceKey('video-sync:03:001'), { h: 3, v: 1 })
})

void test('parseEmbeddedActivityLocationFromInstanceKey rejects malformed numeric anchors', () => {
  assert.equal(parseEmbeddedActivityLocationFromInstanceKey('raffle:3a:1'), null)
  assert.equal(parseEmbeddedActivityLocationFromInstanceKey('raffle:3:1b'), null)
  assert.equal(parseEmbeddedActivityLocationFromInstanceKey('raffle:3.0:1'), null)
  assert.equal(parseEmbeddedActivityLocationFromInstanceKey('raffle::1'), null)
  assert.equal(parseEmbeddedActivityLocationFromInstanceKey('raffle:3:'), null)
})

void test('resolveEmbeddedActivityLocation prefers explicit location over legacy instanceKey parsing', () => {
  assert.deepEqual(
    resolveEmbeddedActivityLocation({
      location: { h: 2, v: 4 },
      instanceKey: 'raffle:3a:1',
    }),
    { h: 2, v: 4 },
  )
})

void test('buildGeneratedEmbeddedActivityInstanceKey emits position or global keys', () => {
  assert.equal(buildGeneratedEmbeddedActivityInstanceKey('raffle', { h: 3, v: 1 }), 'raffle:3:1')
  assert.equal(buildGeneratedEmbeddedActivityInstanceKey('raffle', null), 'raffle:global')
})

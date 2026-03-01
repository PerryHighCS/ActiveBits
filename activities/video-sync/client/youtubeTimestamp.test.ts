import assert from 'node:assert/strict'
import test from 'node:test'
import { parseYouTubeTimestampSeconds } from './youtubeTimestamp.js'

void test('parseYouTubeTimestampSeconds parses numeric seconds', () => {
  assert.equal(parseYouTubeTimestampSeconds('83'), 83)
})

void test('parseYouTubeTimestampSeconds parses minute-second shorthand', () => {
  assert.equal(parseYouTubeTimestampSeconds('1m23s'), 83)
})

void test('parseYouTubeTimestampSeconds parses hour-minute-second shorthand', () => {
  assert.equal(parseYouTubeTimestampSeconds('1h2m3s'), 3723)
})

void test('parseYouTubeTimestampSeconds returns null for invalid shorthand', () => {
  assert.equal(parseYouTubeTimestampSeconds('1minute23seconds'), null)
})

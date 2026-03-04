import assert from 'node:assert/strict'
import test from 'node:test'
import { parseYouTubeStartSecondsFromUrl, parseYouTubeTimestampSeconds } from './youtubeTimestamp.js'

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

void test('parseYouTubeTimestampSeconds preserves large but finite shorthand values', () => {
  assert.equal(parseYouTubeTimestampSeconds('99999h'), 359_996_400)
})

void test('parseYouTubeTimestampSeconds clamps overflowing shorthand values back to zero', () => {
  assert.equal(parseYouTubeTimestampSeconds(`${'9'.repeat(400)}h`), 0)
})

void test('parseYouTubeStartSecondsFromUrl prefers start over t', () => {
  assert.equal(
    parseYouTubeStartSecondsFromUrl('https://youtu.be/dQw4w9WgXcQ?start=120&t=1m23s'),
    120,
  )
})

void test('parseYouTubeStartSecondsFromUrl falls back to t and defaults to zero', () => {
  assert.equal(
    parseYouTubeStartSecondsFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m23s'),
    83,
  )
  assert.equal(
    parseYouTubeStartSecondsFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=oops'),
    0,
  )
})

void test('parseYouTubeStartSecondsFromUrl ignores invalid or unsupported URLs', () => {
  assert.equal(parseYouTubeStartSecondsFromUrl('not a url'), null)
  assert.equal(parseYouTubeStartSecondsFromUrl('https://vimeo.com/1234?t=83'), null)
})

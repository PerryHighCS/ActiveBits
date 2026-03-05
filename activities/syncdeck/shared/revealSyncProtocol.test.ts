import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REVEAL_SYNC_PROTOCOL_VERSION,
  assessRevealSyncProtocolCompatibility,
} from './revealSyncProtocol.js'

void test('assessRevealSyncProtocolCompatibility accepts matching major versions', () => {
  const result = assessRevealSyncProtocolCompatibility(REVEAL_SYNC_PROTOCOL_VERSION)

  assert.equal(result.compatible, true)
  assert.equal(result.reason, 'compatible')
})

void test('assessRevealSyncProtocolCompatibility accepts same major with different minor and patch', () => {
  const result = assessRevealSyncProtocolCompatibility('2.7.19')

  assert.equal(result.compatible, true)
  assert.equal(result.reason, 'compatible')
})

void test('assessRevealSyncProtocolCompatibility rejects missing version values', () => {
  const result = assessRevealSyncProtocolCompatibility(undefined)

  assert.equal(result.compatible, false)
  assert.equal(result.reason, 'missing-version')
})

void test('assessRevealSyncProtocolCompatibility rejects invalid semver strings', () => {
  const result = assessRevealSyncProtocolCompatibility('v2')

  assert.equal(result.compatible, false)
  assert.equal(result.reason, 'invalid-version')
})

void test('assessRevealSyncProtocolCompatibility rejects major mismatches', () => {
  const result = assessRevealSyncProtocolCompatibility('3.0.0')

  assert.equal(result.compatible, false)
  assert.equal(result.reason, 'major-mismatch')
})

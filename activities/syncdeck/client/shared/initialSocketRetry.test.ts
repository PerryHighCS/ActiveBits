import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRetryInitialSocket } from './initialSocketRetry.js'

void test('shouldRetryInitialSocket preserves a live or in-flight socket', () => {
  // CONNECTING (0): a handshake is in flight - do not tear it down.
  assert.equal(shouldRetryInitialSocket(0), false)
  // OPEN (1): already connected - nothing to retry.
  assert.equal(shouldRetryInitialSocket(1), false)
})

void test('shouldRetryInitialSocket retries a socket that never connected', () => {
  // No socket yet.
  assert.equal(shouldRetryInitialSocket(undefined), true)
  assert.equal(shouldRetryInitialSocket(null), true)
  // CLOSING (2) / CLOSED (3): the initial attempt failed - retry.
  assert.equal(shouldRetryInitialSocket(2), true)
  assert.equal(shouldRetryInitialSocket(3), true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { isSyncDeckDebugEnabledFromValues } from './syncDebug.js'

void test('isSyncDeckDebugEnabledFromValues enables debug from query param', () => {
  assert.equal(isSyncDeckDebugEnabledFromValues('?syncdeckDebug=1', null), true)
})

void test('isSyncDeckDebugEnabledFromValues enables debug from storage flag', () => {
  assert.equal(isSyncDeckDebugEnabledFromValues('', '1'), true)
})

void test('isSyncDeckDebugEnabledFromValues keeps debug disabled without opt-in signals', () => {
  assert.equal(isSyncDeckDebugEnabledFromValues('?foo=bar', null), false)
})

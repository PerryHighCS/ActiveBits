import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

void test('SyncDeckStudent eagerly initializes sync debug ref from current URL/storage signals', () => {
  const source = readFileSync(new URL('../student/SyncDeckStudent.tsx', import.meta.url), 'utf8')
  assert.match(source, /const syncDebugEnabledRef = useRef\(isSyncDeckDebugEnabled\(\)\)/)
})

void test('SyncDeckManager eagerly initializes sync debug ref from current URL/storage signals', () => {
  const source = readFileSync(new URL('../manager/SyncDeckManager.tsx', import.meta.url), 'utf8')
  assert.match(source, /const syncDebugEnabledRef = useRef\(isSyncDeckDebugEnabled\(\)\)/)
})

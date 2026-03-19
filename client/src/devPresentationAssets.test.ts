import assert from 'node:assert/strict'
import test from 'node:test'
import { devPresentationAssets, getDevPresentationAsset } from './devPresentationAssets.js'

void test('getDevPresentationAsset resolves the syncdeck conversion lab public path', () => {
  assert.deepEqual(getDevPresentationAsset('/presentations/syncdeck-conversion-lab.html'), devPresentationAssets[0] ?? null)
})

void test('getDevPresentationAsset returns null for unknown public paths', () => {
  assert.equal(getDevPresentationAsset('/presentations/unknown.html'), null)
})

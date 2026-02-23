import assert from 'node:assert/strict'
import test from 'node:test'
import galleryWalkActivity from './index'

void test('gallery-walk client module exports manager/student components', () => {
  assert.equal(typeof galleryWalkActivity.ManagerComponent, 'function')
  assert.equal(typeof galleryWalkActivity.StudentComponent, 'function')
  assert.equal(galleryWalkActivity.footerContent, null)
})

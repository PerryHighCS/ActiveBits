import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidHttpUrl } from './urlValidationUtils'

void test('isValidHttpUrl accepts valid http and https URLs', () => {
  assert.equal(isValidHttpUrl('http://example.com'), true)
  assert.equal(isValidHttpUrl('https://example.com/path?query=value#hash'), true)
  assert.equal(isValidHttpUrl('https://localhost:5173'), true)
})

void test('isValidHttpUrl rejects non-http protocols', () => {
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false)
  assert.equal(isValidHttpUrl('file:///etc/passwd'), false)
  assert.equal(isValidHttpUrl('ftp://example.com/file.txt'), false)
})

void test('isValidHttpUrl rejects relative and hostless paths', () => {
  assert.equal(isValidHttpUrl('/relative/path'), false)
  assert.equal(isValidHttpUrl('relative/path'), false)
  assert.equal(isValidHttpUrl('//example.com/path'), false)
  assert.equal(isValidHttpUrl('?query=only'), false)
})

void test('isValidHttpUrl rejects malformed URLs', () => {
  assert.equal(isValidHttpUrl('http://'), false)
  assert.equal(isValidHttpUrl('https://exa mple.com'), false)
  assert.equal(isValidHttpUrl('not a url'), false)
  assert.equal(isValidHttpUrl(''), false)
})

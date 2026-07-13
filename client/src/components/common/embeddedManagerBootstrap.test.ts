import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_REQUEST,
  readEmbeddedManagerBootstrapRefreshRequest,
  readEmbeddedManagerToken,
  removeEmbeddedManagerToken,
} from './embeddedManagerBootstrap'

void test('readEmbeddedManagerToken returns only a non-empty trimmed manager token', () => {
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=token-123'), 'token-123')
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=%20token-123%20'), 'token-123')
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=%20%20'), null)
  assert.equal(readEmbeddedManagerToken(''), null)
})

void test('removeEmbeddedManagerToken preserves unrelated query parameters', () => {
  assert.equal(
    removeEmbeddedManagerToken('?sourceUrl=https%3A%2F%2Fexample.com&embeddedManagerToken=token-123&mode=manage'),
    '?sourceUrl=https%3A%2F%2Fexample.com&mode=manage',
  )
  assert.equal(removeEmbeddedManagerToken('?embeddedManagerToken=token-123'), '')
})

void test('readEmbeddedManagerBootstrapRefreshRequest accepts only a non-empty child session id', () => {
  assert.equal(
    readEmbeddedManagerBootstrapRefreshRequest({
      type: EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_REQUEST,
      childSessionId: ' CHILD:parent:child:postboard ',
    }),
    'CHILD:parent:child:postboard',
  )
  assert.equal(readEmbeddedManagerBootstrapRefreshRequest({ type: 'other', childSessionId: 'child' }), null)
  assert.equal(readEmbeddedManagerBootstrapRefreshRequest({ type: EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_REQUEST }), null)
})

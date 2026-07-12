import assert from 'node:assert/strict'
import test from 'node:test'
import { readEmbeddedManagerToken } from './embeddedManagerBootstrap'

void test('readEmbeddedManagerToken returns only a non-empty trimmed manager token', () => {
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=token-123'), 'token-123')
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=%20token-123%20'), 'token-123')
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=%20%20'), null)
  assert.equal(readEmbeddedManagerToken(''), null)
})

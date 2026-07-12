import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeSessionDataToken } from './sessionTokenUtils.js'

void test('consumeSessionDataToken rejects expired entries without deleting them', () => {
  const session = {
    data: {
      embeddedManagerEntryToken: { value: 'token-value', expiresAt: 100 },
    },
  }

  assert.equal(
    consumeSessionDataToken(session, 'embeddedManagerEntryToken', 'token-value', 100),
    null,
  )
  assert.deepEqual(session.data.embeddedManagerEntryToken, { value: 'token-value', expiresAt: 100 })
})

void test('consumeSessionDataToken consumes a matching unexpired entry', () => {
  const session = {
    data: {
      embeddedManagerEntryToken: { value: 'token-value', expiresAt: 101 },
    },
  }

  assert.equal(
    consumeSessionDataToken(session, 'embeddedManagerEntryToken', 'token-value', 100),
    session,
  )
  assert.equal(session.data.embeddedManagerEntryToken, undefined)
})

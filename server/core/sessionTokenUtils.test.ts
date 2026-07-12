import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeSessionDataToken } from './sessionTokenUtils.js'

void test('consumeSessionDataToken rejects expired entries without deleting them', () => {
  const session = {
    data: {
      embeddedManagerEntryToken: { value: 'token-value', expiresAt: 100 },
    },
  }

  console.info('[TEST] expected token rejection: expired entry')
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

void test('consumeSessionDataToken rejects non-finite numeric expiry values without deleting them', () => {
  const session = {
    data: {
      embeddedManagerEntryToken: { value: 'token-value', expiresAt: Number.POSITIVE_INFINITY },
    },
  }

  console.info('[TEST] expected token rejection: non-finite expiry')
  assert.equal(
    consumeSessionDataToken(session, 'embeddedManagerEntryToken', 'token-value', 100),
    null,
  )
  assert.deepEqual(session.data.embeddedManagerEntryToken, { value: 'token-value', expiresAt: Number.POSITIVE_INFINITY })
})

void test('consumeSessionDataToken rejects present malformed expiry values without deleting them', () => {
  for (const expiresAt of ['not-a-timestamp', null]) {
    const session = {
      data: {
        embeddedManagerEntryToken: { value: 'token-value', expiresAt },
      },
    }

    console.info('[TEST] expected token rejection: malformed expiry')
    assert.equal(
      consumeSessionDataToken(session, 'embeddedManagerEntryToken', 'token-value', 100),
      null,
    )
    assert.deepEqual(session.data.embeddedManagerEntryToken, { value: 'token-value', expiresAt })
  }
})

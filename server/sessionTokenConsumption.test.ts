import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionStore, type SessionRecord } from './core/sessions.js'

void test('session data tokens are consumed only once under concurrent requests', async (t) => {
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
  })
  const session: SessionRecord = {
    id: 'token-session',
    type: 'test',
    created: Date.now(),
    lastActivity: 1,
    data: {
      oneTimeToken: { value: 'token-value' },
    },
  }
  await sessions.set(session.id, session)
  const consumeSessionDataToken = sessions.consumeSessionDataToken
  assert.ok(consumeSessionDataToken)

  const results = await Promise.all([
    consumeSessionDataToken.call(sessions, session.id, 'oneTimeToken', 'token-value'),
    consumeSessionDataToken.call(sessions, session.id, 'oneTimeToken', 'token-value'),
  ])

  assert.equal(results.filter((result) => result !== null).length, 1)
  const consumedSession = await sessions.get(session.id)
  assert.equal(consumedSession?.data.oneTimeToken, undefined)
  assert.ok((consumedSession?.lastActivity ?? 0) > 1)
})

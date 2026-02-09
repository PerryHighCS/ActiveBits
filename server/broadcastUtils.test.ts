import test from 'node:test'
import assert from 'node:assert/strict'
import { createBroadcastSubscriptionHelper } from './core/broadcastUtils.js'

interface MockBroadcastMessage {
  type: string
}

interface MockClient {
  sessionId: string
  readyState: number
  send(msg: string): void
}

void test('createBroadcastSubscriptionHelper subscribes once and forwards messages', () => {
  let subscribedChannel: string | null = null
  let broadcastHandler: ((message: MockBroadcastMessage) => void) | null = null

  const sessions = {
    subscribeToBroadcast: (channel: string, handler: (message: MockBroadcastMessage) => void) => {
      if (subscribedChannel) {
        throw new Error('subscribe called multiple times')
      }
      subscribedChannel = channel
      broadcastHandler = handler
    },
  }

  const sentPayloads: string[] = []
  const ws = {
    wss: {
      clients: new Set<MockClient>([
        { sessionId: 'abc', readyState: 1, send: (msg) => sentPayloads.push(msg) },
        { sessionId: 'abc', readyState: 0, send: () => { throw new Error('should not send when not ready') } },
        { sessionId: 'other', readyState: 1, send: () => { throw new Error('wrong session') } },
        {
          sessionId: 'abc',
          readyState: 1,
          send: () => {
            throw new Error('send failure')
          },
        },
      ]),
    },
  }

  const ensure = createBroadcastSubscriptionHelper(sessions, ws)
  ensure('abc')
  ensure('abc')
  ensure('')

  assert.equal(subscribedChannel, 'session:abc:broadcast')
  assert.ok(broadcastHandler, 'handler registered')

  console.log('[TEST] Testing broadcast robustness against individual WebSocket send failures (expected error output follows):')
  assert.doesNotThrow(() => {
    void broadcastHandler?.({ type: 'foo' })
  })
  assert.equal(sentPayloads.length, 1)
  assert.equal(sentPayloads[0], JSON.stringify({ type: 'foo' }))
})

void test('createBroadcastSubscriptionHelper no-ops without subscribe support or session id', () => {
  const sessions = {}
  const ws = { wss: { clients: new Set<MockClient>() } }
  const ensure = createBroadcastSubscriptionHelper(sessions, ws)

  assert.doesNotThrow(() => ensure('abc'))
  assert.doesNotThrow(() => ensure(null))

  const sessionsWithSubscribe = {
    subscribeToBroadcast: () => {
      throw new Error('should not subscribe when sessionId missing')
    },
  }
  const ensureMissingId = createBroadcastSubscriptionHelper(sessionsWithSubscribe, ws)
  assert.doesNotThrow(() => ensureMissingId(null))
})

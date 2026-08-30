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
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  assert.ok(broadcastHandler, 'handler was registered')

  console.log('[TEST] Testing broadcast robustness against individual WebSocket send failures (expected error output follows):')
  assert.doesNotThrow(() => {
    // After assert.ok(), we know broadcastHandler is not null/undefined
    void broadcastHandler!({ type: 'foo' })
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

void test('createBroadcastSubscriptionHelper continues after a forwarding predicate failure', () => {
  let broadcastHandler: ((message: MockBroadcastMessage) => void) | null = null
  const rejectedClient: MockClient = { sessionId: 'abc', readyState: 1, send: () => { throw new Error('must not send') } }
  const sentPayloads: string[] = []
  const forwardedClient: MockClient = {
    sessionId: 'abc',
    readyState: 1,
    send: (msg) => sentPayloads.push(msg),
  }
  const sessions = {
    subscribeToBroadcast: (_channel: string, handler: (message: MockBroadcastMessage) => void) => {
      broadcastHandler = handler
    },
  }
  const ws = { wss: { clients: new Set<MockClient>([rejectedClient, forwardedClient]) } }
  const ensure = createBroadcastSubscriptionHelper(sessions, ws, (client) => {
    if (client === rejectedClient) throw new Error('predicate failed')
    return true
  })

  ensure('abc')
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  assert.ok(broadcastHandler, 'handler was registered')
  console.log('[TEST] Testing broadcast robustness against predicate failures (expected error output follows):')
  assert.doesNotThrow(() => void broadcastHandler!({ type: 'foo' }))
  assert.deepEqual(sentPayloads, [JSON.stringify({ type: 'foo' })])
})

void test('createBroadcastSubscriptionHelper applies transformMessage to the client payload but not the predicate', () => {
  let broadcastHandler: ((message: unknown) => void) | null = null
  const sentPayloads: string[] = []
  const predicateSawAudience: unknown[] = []
  const sessions = {
    subscribeToBroadcast: (_channel: string, handler: (message: unknown) => void) => { broadcastHandler = handler },
  }
  const ws = { wss: { clients: new Set([{ sessionId: 'abc', readyState: 1, send: (m: string) => sentPayloads.push(m) }]) } }
  const ensure = createBroadcastSubscriptionHelper(
    sessions,
    ws,
    (_client, message) => {
      predicateSawAudience.push((message as { audience?: unknown }).audience)
      return true
    },
    (message) => ({ type: (message as { type?: unknown }).type, payload: (message as { payload?: unknown }).payload }),
  )

  ensure('abc')
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  assert.ok(broadcastHandler, 'handler was registered')
  assert.doesNotThrow(() => void broadcastHandler!({ type: 'foo', payload: { a: 1 }, audience: 'manager', origin: 'inst-1' }))

  assert.deepEqual(predicateSawAudience, ['manager'], 'predicate still sees the raw envelope')
  assert.deepEqual(JSON.parse(sentPayloads[0] as string), { type: 'foo', payload: { a: 1 } })
})

void test('createBroadcastSubscriptionHelper fails closed when transform or serialization throws', () => {
  let broadcastHandler: ((message: unknown) => void) | null = null
  const sentPayloads: string[] = []
  const sessions = {
    subscribeToBroadcast: (_channel: string, handler: (message: unknown) => void) => { broadcastHandler = handler },
  }
  const ws = { wss: { clients: new Set([{ sessionId: 'abc', readyState: 1, send: (m: string) => sentPayloads.push(m) }]) } }
  const ensure = createBroadcastSubscriptionHelper(
    sessions,
    ws,
    () => true,
    () => { throw new Error('bad shape') },
  )

  ensure('abc')
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  assert.ok(broadcastHandler, 'handler was registered')
  console.log('[TEST] broadcast transform failure is expected below (fail closed, no delivery):')
  assert.doesNotThrow(() => void broadcastHandler!({ type: 'foo' }))
  assert.equal(sentPayloads.length, 0, 'nothing is delivered for an unprocessable message')
})

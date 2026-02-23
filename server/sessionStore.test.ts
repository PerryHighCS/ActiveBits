import test from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createSessionStore, createSession } from './core/sessions.js'
import { createWsRouter } from './core/wsRouter.js'
import { registerSessionNormalizer, resetSessionNormalizersForTests } from './core/sessionNormalization.js'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

void test('inactive sessions expire', async () => {
  const sessions = createSessionStore(null, 50)
  const session = await createSession(sessions)
  await wait(60)
  sessions.cleanup()
  assert.strictEqual(await sessions.get(session.id), null)
})

void test('active sessions persist', async () => {
  const sessions = createSessionStore(null, 50)
  const session = await createSession(sessions)
  await wait(40)
  await sessions.touch(session.id)
  await wait(40)
  sessions.cleanup()
  assert.ok(await sessions.get(session.id))
  await wait(60)
  sessions.cleanup()
  assert.strictEqual(await sessions.get(session.id), null)
})

void test('keepalive refreshes session activity', async () => {
  const sessions = createSessionStore(null, 50)
  const session = await createSession(sessions)
  const server = http.createServer()
  const router = createWsRouter(server, sessions)
  router.register('/ws', (socket, query) => {
    socket.sessionId = query.get('sessionId')
  })

  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to bind test server')
  }
  const ws = new WebSocket(`ws://localhost:${address.port}/ws?sessionId=${session.id}`)
  await new Promise<void>((resolve) => ws.once('open', () => resolve()))

  await wait(40)
  await new Promise<void>((resolve) => {
    ws.once('pong', () => resolve())
    ws.ping()
  })
  await wait(20)
  sessions.cleanup()
  assert.ok(await sessions.get(session.id))

  await wait(60)
  sessions.cleanup()
  assert.strictEqual(await sessions.get(session.id), null)

  ws.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

void test('registered session normalizers populate activity defaults', async (t) => {
  resetSessionNormalizersForTests()
  registerSessionNormalizer('test-activity', (session) => {
    const typedSession = session as { data: { items?: unknown } }
    typedSession.data.items = Array.isArray(typedSession.data.items) ? typedSession.data.items : []
  })

  const sessions = createSessionStore(null, 100)
  t.after(async () => {
    await sessions.close()
    resetSessionNormalizersForTests()
  })

  const session = await createSession(sessions)
  session.type = 'test-activity'
  await sessions.set(session.id, session)

  const loaded = await sessions.get(session.id)
  assert.ok(loaded)
  const loadedItems = (loaded.data as { items?: unknown }).items
  assert.ok(Array.isArray(loadedItems))
  assert.equal(loadedItems.length, 0)
})

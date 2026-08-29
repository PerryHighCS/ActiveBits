import assert from 'node:assert/strict'
import test from 'node:test'
import { createWsRouter, isActivityWebSocketPath } from './wsRouter.js'

void test('activity WebSocket routing does not claim unrelated upgrade paths', () => {
  assert.equal(isActivityWebSocketPath('/ws'), true)
  assert.equal(isActivityWebSocketPath('/ws/java-format-practice'), true)
  assert.equal(isActivityWebSocketPath('/vite-hmr'), false)
  assert.equal(isActivityWebSocketPath('/socket.io'), false)
})

interface FakeUpgradeSocket {
  destroyed: boolean
  destroy(): void
}

function createFakeUpgradeSocket(): FakeUpgradeSocket {
  return {
    destroyed: false,
    destroy() {
      this.destroyed = true
    },
  }
}

type FakeUpgradeHandler = (
  req: { url?: string | null; headers: Record<string, string> },
  socket: FakeUpgradeSocket,
  head: Buffer,
) => void

function createFakeUpgradeServer() {
  const upgradeListeners: FakeUpgradeHandler[] = []
  return {
    upgradeListeners,
    on(event: string, handler: FakeUpgradeHandler) {
      if (event === 'upgrade') upgradeListeners.push(handler)
    },
    listenerCount(event: string) {
      return event === 'upgrade' ? upgradeListeners.length : 0
    },
  }
}

void test('createWsRouter upgrade handler defers non-activity paths only when another upgrade listener exists', () => {
  const server = createFakeUpgradeServer()
  createWsRouter(server as never, {} as never)
  const [upgradeHandler] = server.upgradeListeners
  assert.ok(upgradeHandler, 'createWsRouter must register an upgrade handler')

  // Development: the Vite HMR proxy adds its own 'upgrade' listener, so a path
  // this router does not own must be left open for that listener to claim.
  server.on('upgrade', () => {})
  const hmrSocket = createFakeUpgradeSocket()
  upgradeHandler({ url: '/vite-hmr', headers: {} }, hmrSocket, Buffer.alloc(0))
  assert.equal(hmrSocket.destroyed, false)
})

void test('createWsRouter upgrade handler destroys unknown paths when it is the only upgrade listener', () => {
  const server = createFakeUpgradeServer()
  createWsRouter(server as never, {} as never)
  const [upgradeHandler] = server.upgradeListeners
  assert.ok(upgradeHandler, 'createWsRouter must register an upgrade handler')

  // Production: no other 'upgrade' listener is registered, so a stray non-activity
  // upgrade (e.g. /socket.io) would leak if left open — destroy it.
  const straySocket = createFakeUpgradeSocket()
  upgradeHandler({ url: '/socket.io', headers: {} }, straySocket, Buffer.alloc(0))
  assert.equal(straySocket.destroyed, true)

  // An unclaimed activity WebSocket path is always this router's responsibility.
  const unknownActivitySocket = createFakeUpgradeSocket()
  upgradeHandler({ url: '/ws/not-registered', headers: {} }, unknownActivitySocket, Buffer.alloc(0))
  assert.equal(unknownActivitySocket.destroyed, true)
})

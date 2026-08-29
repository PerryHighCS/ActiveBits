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

void test('createWsRouter upgrade handler leaves non-activity paths alone and destroys unknown activity paths', () => {
  let upgradeHandler:
    | ((req: { url?: string | null; headers: Record<string, string> }, socket: FakeUpgradeSocket, head: Buffer) => void)
    | undefined
  const server = {
    on(event: string, handler: typeof upgradeHandler) {
      if (event === 'upgrade') upgradeHandler = handler
    },
  }

  createWsRouter(server as never, {} as never)
  assert.ok(upgradeHandler, 'createWsRouter must register an upgrade handler')

  // A path this router does not own (e.g. the dev Vite HMR proxy) must be left
  // open so another upgrade handler on the same server can claim it.
  const hmrSocket = createFakeUpgradeSocket()
  upgradeHandler({ url: '/vite-hmr', headers: {} }, hmrSocket, Buffer.alloc(0))
  assert.equal(hmrSocket.destroyed, false)

  // An unclaimed activity WebSocket path is this router's responsibility and
  // must not be left dangling.
  const unknownActivitySocket = createFakeUpgradeSocket()
  upgradeHandler({ url: '/ws/not-registered', headers: {} }, unknownActivitySocket, Buffer.alloc(0))
  assert.equal(unknownActivitySocket.destroyed, true)
})

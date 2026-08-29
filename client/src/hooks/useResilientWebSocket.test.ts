import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { getReconnectDelay, resolveWebSocketUrl, useResilientWebSocket } from './useResilientWebSocket'

void test('resolveWebSocketUrl resolves literal urls and builder callbacks', () => {
  assert.equal(resolveWebSocketUrl('ws://localhost:3000'), 'ws://localhost:3000')
  assert.equal(resolveWebSocketUrl(() => 'wss://example.test/socket'), 'wss://example.test/socket')
  assert.equal(resolveWebSocketUrl(() => null), null)
  assert.equal(resolveWebSocketUrl(undefined), null)
})

void test('getReconnectDelay applies exponential backoff and maximum cap', () => {
  assert.equal(getReconnectDelay(0, 1000, 30000), 1000)
  assert.equal(getReconnectDelay(1, 1000, 30000), 2000)
  assert.equal(getReconnectDelay(2, 1000, 30000), 4000)
  assert.equal(getReconnectDelay(5, 1000, 30000), 30000)
})

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  readyState = 1
  closed = false

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  emitClose(code: number): void {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

function installDomEnvironment(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://activebits.local/',
  })
  const keys = ['window', 'document', 'navigator', 'WebSocket', 'IS_REACT_ACT_ENVIRONMENT'] as const
  const descriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of keys) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
    dom.window.close()
  }
}

void test('a terminal close does not reconnect and a changed isTerminalClose identity does not re-open the socket', () => {
  const restoreDom = installDomEnvironment()
  FakeWebSocket.instances.length = 0
  const container = document.getElementById('root')
  assert.ok(container)
  const root = createRoot(container)

  let forceRerender: (() => void) | null = null

  function Probe(): null {
    const [, setTick] = useState(0)
    forceRerender = () => setTick((value) => value + 1)
    // A brand-new function identity on every render used to change `connect`'s
    // identity and tear down / reopen the mounted socket.
    useResilientWebSocket({
      buildUrl: 'wss://example.test/socket',
      connectOnMount: true,
      shouldReconnect: true,
      isTerminalClose: (event) => (event as { code?: number }).code === 1008,
    })
    return null
  }

  try {
    act(() => {
      root.render(createElement(Probe))
    })
    assert.equal(FakeWebSocket.instances.length, 1, 'exactly one socket opens on mount')

    act(() => {
      FakeWebSocket.instances[0]!.emitClose(1008)
    })
    assert.equal(FakeWebSocket.instances.length, 1, 'a terminal 1008 close must not schedule a reconnect')

    act(() => {
      forceRerender?.()
    })
    assert.equal(
      FakeWebSocket.instances.length,
      1,
      'an unrelated rerender (new isTerminalClose identity) must not open another socket',
    )

    act(() => {
      root.unmount()
    })
  } finally {
    restoreDom()
  }
})

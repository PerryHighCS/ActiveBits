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

  emitOpen(): void {
    this.onopen?.({})
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data })
  }

  emitError(): void {
    this.onerror?.({})
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

const RECONNECT_BASE_MS = 20

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

void test('a non-terminal close reconnects after the backoff delay (control)', async () => {
  const restoreDom = installDomEnvironment()
  FakeWebSocket.instances.length = 0
  const container = document.getElementById('root')
  assert.ok(container)
  const root = createRoot(container)

  function Probe(): null {
    useResilientWebSocket({
      buildUrl: 'wss://example.test/socket',
      connectOnMount: true,
      shouldReconnect: true,
      reconnectDelayBase: RECONNECT_BASE_MS,
      reconnectDelayMax: RECONNECT_BASE_MS,
      isTerminalClose: (event) => (event as { code?: number }).code === 1008,
    })
    return null
  }

  try {
    await act(async () => {
      root.render(createElement(Probe))
    })
    assert.equal(FakeWebSocket.instances.length, 1, 'exactly one socket opens on mount')

    await act(async () => {
      console.info('[TEST] simulating a non-terminal 1006 close; a reconnect is expected')
      FakeWebSocket.instances[0]!.emitClose(1006)
      await sleep(RECONNECT_BASE_MS * 4)
    })
    assert.equal(
      FakeWebSocket.instances.length,
      2,
      'a non-terminal close must reconnect once the backoff timer fires',
    )

    await act(async () => {
      root.unmount()
    })
  } finally {
    restoreDom()
  }
})

void test('a terminal close does not reconnect and a changed isTerminalClose identity does not re-open the socket', async () => {
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
      reconnectDelayBase: RECONNECT_BASE_MS,
      reconnectDelayMax: RECONNECT_BASE_MS,
      isTerminalClose: (event) => (event as { code?: number }).code === 1008,
    })
    return null
  }

  try {
    await act(async () => {
      root.render(createElement(Probe))
    })
    assert.equal(FakeWebSocket.instances.length, 1, 'exactly one socket opens on mount')

    await act(async () => {
      console.info('[TEST] simulating a terminal 1008 close; no reconnect is expected')
      FakeWebSocket.instances[0]!.emitClose(1008)
      // Wait well past the reconnect backoff so a missed terminal check would surface.
      await sleep(RECONNECT_BASE_MS * 4)
    })
    assert.equal(FakeWebSocket.instances.length, 1, 'a terminal 1008 close must not schedule a reconnect')

    await act(async () => {
      forceRerender?.()
      await sleep(RECONNECT_BASE_MS * 4)
    })
    assert.equal(
      FakeWebSocket.instances.length,
      1,
      'an unrelated rerender (new isTerminalClose identity) must not open another socket',
    )

    await act(async () => {
      root.unmount()
    })
  } finally {
    restoreDom()
  }
})

void test('stale socket events cannot change the live connection state', async () => {
  const restoreDom = installDomEnvironment()
  FakeWebSocket.instances.length = 0
  const container = document.getElementById('root')
  assert.ok(container)
  const root = createRoot(container)
  let reconnect: (() => WebSocket | null) | null = null
  let openCalls = 0
  let messageCalls = 0
  let errorCalls = 0
  let closeCalls = 0

  function Probe(): null {
    const connection = useResilientWebSocket({
      buildUrl: 'wss://example.test/socket',
      connectOnMount: true,
      shouldReconnect: false,
      onOpen: () => { openCalls += 1 },
      onMessage: () => { messageCalls += 1 },
      onError: () => { errorCalls += 1 },
      onClose: () => { closeCalls += 1 },
    })
    reconnect = connection.connect
    return null
  }

  try {
    await act(async () => {
      root.render(createElement(Probe))
    })
    const firstSocket = FakeWebSocket.instances[0]
    assert.ok(firstSocket)

    await act(async () => {
      reconnect?.()
    })
    const secondSocket = FakeWebSocket.instances[1]
    assert.ok(secondSocket)

    // connect() already closed the replaced socket; clear the flag so the assertion
    // below proves the onopen handler itself re-closes a stale socket that opens late.
    firstSocket.closed = false

    await act(async () => {
      console.info('[TEST] every event from the replaced socket must be ignored and the stale socket closed on open')
      firstSocket.emitOpen()
      firstSocket.emitMessage('stale-payload')
      firstSocket.emitError()
      firstSocket.emitClose(1006)
    })
    assert.equal(openCalls, 0, 'a stale open must not reach the consumer')
    assert.equal(messageCalls, 0, 'a stale message must not reach the consumer')
    assert.equal(errorCalls, 0, 'a stale error must not reach the consumer')
    assert.equal(closeCalls, 0, 'a stale close must not reach the consumer')
    assert.equal(firstSocket.closed, true, 'a stale socket that opens late must be closed')

    await act(async () => {
      secondSocket.emitOpen()
      secondSocket.emitMessage('live-payload')
    })
    assert.equal(openCalls, 1, 'the current socket still delivers open')
    assert.equal(messageCalls, 1, 'the current socket still delivers messages')

    await act(async () => {
      console.info('[TEST] closing the current socket with an intentional abnormal 1006 code')
      secondSocket.emitClose(1006)
    })
    assert.equal(closeCalls, 1)

    await act(async () => {
      root.unmount()
    })
  } finally {
    restoreDom()
  }
})

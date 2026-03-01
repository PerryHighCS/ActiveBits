import assert from 'node:assert/strict'
import test from 'node:test'
import { runSyncDeckPresentationPreflight } from './presentationPreflight.js'

type MessageListener = (event: MessageEvent) => void
type IframeListener = () => void

interface FakeIframe {
  src: string
  style: Record<string, string>
  contentWindow: {
    postMessageCalls: Array<{ message: unknown; targetOrigin: string }>
    postMessage: (message: unknown, targetOrigin: string) => void
  }
  setAttribute: (name: string, value: string) => void
  addEventListener: (name: 'load' | 'error', listener: IframeListener) => void
  removeEventListener: (name: 'load' | 'error', listener: IframeListener) => void
  remove: () => void
  dispatch: (name: 'load' | 'error') => void
  removed: boolean
  attributes: Record<string, string>
}

function createFakeIframe(): FakeIframe {
  const listeners = new Map<'load' | 'error', Set<IframeListener>>([
    ['load', new Set<IframeListener>()],
    ['error', new Set<IframeListener>()],
  ])

  const iframe: FakeIframe = {
    src: '',
    style: {},
    contentWindow: {
      postMessageCalls: [],
      postMessage(message: unknown, targetOrigin: string) {
        iframe.contentWindow.postMessageCalls.push({ message, targetOrigin })
      },
    },
    attributes: {},
    setAttribute(name: string, value: string) {
      iframe.attributes[name] = value
    },
    addEventListener(name, listener) {
      listeners.get(name)?.add(listener)
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener)
    },
    remove() {
      iframe.removed = true
    },
    dispatch(name) {
      for (const listener of listeners.get(name) ?? []) {
        listener()
      }
    },
    removed: false,
  }

  return iframe
}

function installFakeDom() {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document

  const messageListeners = new Set<MessageListener>()
  const iframe = createFakeIframe()
  const appendedNodes: unknown[] = []

  const fakeWindow = {
    addEventListener(name: string, listener: EventListenerOrEventListenerObject) {
      if (name === 'message') {
        messageListeners.add(listener as MessageListener)
      }
    },
    removeEventListener(name: string, listener: EventListenerOrEventListenerObject) {
      if (name === 'message') {
        messageListeners.delete(listener as MessageListener)
      }
    },
    dispatchMessage(event: MessageEvent) {
      for (const listener of [...messageListeners]) {
        listener(event)
      }
    },
  }

  const fakeDocument = {
    createElement(tagName: string) {
      assert.equal(tagName, 'iframe')
      return iframe
    },
    body: {
      appendChild(node: unknown) {
        appendedNodes.push(node)
      },
    },
  }

  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
  })

  return {
    iframe,
    appendedNodes,
    dispatchMessage(data: unknown, origin = 'https://slides.example') {
      fakeWindow.dispatchMessage({
        data,
        origin,
        source: iframe.contentWindow,
      } as unknown as MessageEvent)
    },
    restore() {
      Object.assign(globalThis, {
        window: originalWindow,
        document: originalDocument,
      })
    },
  }
}

void test('runSyncDeckPresentationPreflight accepts ready handshake from presentation iframe', async () => {
  const dom = installFakeDom()

  try {
    const pending = runSyncDeckPresentationPreflight('https://slides.example/deck', { timeoutMs: 100 })
    dom.iframe.dispatch('load')
    dom.dispatchMessage({
      type: 'reveal-sync',
      action: 'ready',
      payload: {
        reason: 'init',
      },
    })

    const result = await pending

    assert.deepEqual(result, { valid: true, warning: null })
    assert.equal(dom.appendedNodes.length, 1)
    assert.equal(dom.iframe.attributes.sandbox, 'allow-scripts allow-same-origin')
    assert.equal(dom.iframe.contentWindow.postMessageCalls.length, 1)
    assert.equal((dom.iframe.contentWindow.postMessageCalls[0]?.message as { payload?: { name?: unknown } })?.payload?.name, 'ping')
    assert.equal(dom.iframe.removed, true)
  } finally {
    dom.restore()
  }
})

void test('runSyncDeckPresentationPreflight accepts pong handshake from presentation iframe', async () => {
  const dom = installFakeDom()

  try {
    const pending = runSyncDeckPresentationPreflight('https://slides.example/deck', { timeoutMs: 100 })
    dom.iframe.dispatch('load')
    dom.dispatchMessage({
      type: 'reveal-sync',
      action: 'pong',
      payload: {
        ok: true,
      },
    })

    const result = await pending

    assert.deepEqual(result, { valid: true, warning: null })
    assert.equal(dom.iframe.removed, true)
  } finally {
    dom.restore()
  }
})

void test('runSyncDeckPresentationPreflight ignores pong handshake without ok true payload', async () => {
  const dom = installFakeDom()

  try {
    const pending = runSyncDeckPresentationPreflight('https://slides.example/deck', { timeoutMs: 25 })
    dom.iframe.dispatch('load')
    dom.dispatchMessage({
      type: 'reveal-sync',
      action: 'pong',
      payload: {
        ok: false,
      },
    })

    const result = await pending

    assert.deepEqual(result, {
      valid: false,
      warning: 'Presentation did not respond to sync ping in time. You can continue anyway.',
    })
    assert.equal(dom.iframe.removed, true)
  } finally {
    dom.restore()
  }
})

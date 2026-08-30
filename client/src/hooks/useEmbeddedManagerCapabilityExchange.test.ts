import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import {
  EmbeddedManagerPasscodeExchangeUnavailableError,
} from './useEmbeddedManagerPasscodeExchange'
import { fetchEmbeddedManagerCapability, useEmbeddedManagerCapabilityExchange } from './useEmbeddedManagerCapabilityExchange'

function CapabilityProbe({ search }: { search: string }): null {
  useEmbeddedManagerCapabilityExchange({ sessionId: 'child-session', search })
  return null
}

function installDomEnvironment(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://activebits.local/manage/activity/child-session?embeddedManagerToken=token-1',
  })
  const descriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

void test('fetchEmbeddedManagerCapability requests the cookie-only no-store exchange', async () => {
  let request: { input: string; init: RequestInit } | null = null
  const authorized = await fetchEmbeddedManagerCapability({
    sessionId: 'child session',
    token: 'token/value',
    fetchImpl: async (input, init) => {
      request = { input, init }
      return { ok: true }
    },
  })

  assert.equal(authorized, true)
  assert.deepEqual(request, {
    input: '/api/syncdeck/embedded-manager-capability?sessionId=child%20session&token=token%2Fvalue',
    init: { credentials: 'same-origin', cache: 'no-store' },
  })
})

void test('fetchEmbeddedManagerCapability distinguishes invalid and temporary failures', async () => {
  assert.equal(await fetchEmbeddedManagerCapability({
    sessionId: 'child', token: 'invalid', fetchImpl: async () => ({ ok: false, status: 403 }),
  }), false)
  console.info('[TEST] Expected embedded-manager capability exchange server failure.')
  await assert.rejects(
    fetchEmbeddedManagerCapability({
      sessionId: 'child', token: 'retry', fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    (error: unknown) => error instanceof EmbeddedManagerPasscodeExchangeUnavailableError,
  )
})

void test('useEmbeddedManagerCapabilityExchange requests bounded bootstrap refreshes after temporary failures', async () => {
  const restoreDom = installDomEnvironment()
  const originalFetch = globalThis.fetch
  const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent')
  const refreshRequests: Array<{ payload: unknown; targetOrigin: string }> = []
  globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage(payload: unknown, targetOrigin: string) { refreshRequests.push({ payload, targetOrigin }) } },
  })
  const root = createRoot(document.getElementById('root') as Element)

  try {
    console.info('[TEST] Expected temporary embedded-manager capability exchange failures.')
    for (const token of ['token-1', 'token-2', 'token-3', 'token-4']) {
      await act(async () => { root.render(createElement(CapabilityProbe, { search: `?embeddedManagerToken=${token}` })) })
      await flushAsyncWork()
    }
    assert.deepEqual(refreshRequests, [
      { payload: { type: 'embedded-manager-bootstrap-refresh', childSessionId: 'child-session' }, targetOrigin: 'https://activebits.local' },
      { payload: { type: 'embedded-manager-bootstrap-refresh', childSessionId: 'child-session' }, targetOrigin: 'https://activebits.local' },
      { payload: { type: 'embedded-manager-bootstrap-refresh', childSessionId: 'child-session' }, targetOrigin: 'https://activebits.local' },
    ])
  } finally {
    await act(async () => { root.unmount() })
    if (parentDescriptor) Object.defineProperty(window, 'parent', parentDescriptor)
    globalThis.fetch = originalFetch
    restoreDom()
  }
})

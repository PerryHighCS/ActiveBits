import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import {
  fetchEmbeddedManagerPasscode,
  nextEmbeddedManagerBootstrapRefreshAttempt,
  useEmbeddedManagerPasscodeExchange,
} from './useEmbeddedManagerPasscodeExchange'

interface ExchangeState {
  passcode: string | null
  isResolving: boolean
  error: unknown | null
}

function ExchangeProbe({ onState }: { onState: (state: ExchangeState) => void }): null {
  const state = useEmbeddedManagerPasscodeExchange({
    sessionId: 'child-session',
    search: '?embeddedManagerToken=token-123',
  })
  useEffect(() => {
    onState(state)
  }, [onState, state])
  return null
}

function installDomEnvironment(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://activebits.local/manage/activity/child-session?embeddedManagerToken=token-123',
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
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
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

function createDeferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
} {
  let resolvePromise: ((value: T) => void) | null = null
  let rejectPromise: ((error: Error) => void) | null = null
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value)
    },
    reject(error) {
      rejectPromise?.(error)
    },
  }
}

void test('fetchEmbeddedManagerPasscode requests a no-store same-origin token exchange', async () => {
  let request: { input: string; init: RequestInit } | null = null
  const passcode = await fetchEmbeddedManagerPasscode({
    sessionId: 'child session',
    token: 'token/value',
    fetchImpl: async (input, init) => {
      request = { input, init }
      return { ok: true, json: async () => ({ instructorPasscode: ' teacher-pass ' }) }
    },
  })

  assert.equal(passcode, 'teacher-pass')
  assert.deepEqual(request, {
    input: '/api/syncdeck/embedded-manager-passcode?sessionId=child%20session&token=token%2Fvalue',
    init: { credentials: 'same-origin', cache: 'no-store' },
  })
})

void test('fetchEmbeddedManagerPasscode rejects invalid exchange responses without a passcode', async () => {
  assert.equal(
    await fetchEmbeddedManagerPasscode({
      sessionId: 'child',
      token: 'token',
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    }),
    null,
  )
  assert.equal(
    await fetchEmbeddedManagerPasscode({
      sessionId: 'child',
      token: 'token',
      fetchImpl: async () => ({ ok: true, json: async () => ({ instructorPasscode: '   ' }) }),
    }),
    null,
  )
})

void test('nextEmbeddedManagerBootstrapRefreshAttempt caps refresh attempts per child session', () => {
  assert.equal(nextEmbeddedManagerBootstrapRefreshAttempt(0), 1)
  assert.equal(nextEmbeddedManagerBootstrapRefreshAttempt(2), 3)
  assert.equal(nextEmbeddedManagerBootstrapRefreshAttempt(3), null)
  assert.equal(nextEmbeddedManagerBootstrapRefreshAttempt(-1), null)
  assert.equal(nextEmbeddedManagerBootstrapRefreshAttempt(0.5), null)
})

void test('useEmbeddedManagerPasscodeExchange reports resolving and successful passcode states', async () => {
  const restoreDom = installDomEnvironment()
  const originalFetch = globalThis.fetch
  const deferredFetch = createDeferred<Response>()
  globalThis.fetch = (() => deferredFetch.promise) as typeof fetch
  const states: ExchangeState[] = []
  const root = createRoot(document.getElementById('root') as Element)

  try {
    await act(async () => {
      root.render(createElement(ExchangeProbe, { onState: (state) => states.push(state) }))
    })
    await flushAsyncWork()
    assert.equal(states.at(-1)?.isResolving, true)

    deferredFetch.resolve({
      ok: true,
      json: async () => ({ instructorPasscode: 'teacher-pass' }),
    } as Response)
    await flushAsyncWork()
    assert.deepEqual(states.at(-1), {
      passcode: 'teacher-pass',
      isResolving: false,
      error: null,
    })
  } finally {
    await act(async () => {
      root.unmount()
    })
    globalThis.fetch = originalFetch
    restoreDom()
  }
})

void test('useEmbeddedManagerPasscodeExchange removes the token after an invalid exchange response', async () => {
  const restoreDom = installDomEnvironment()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
  const root = createRoot(document.getElementById('root') as Element)

  try {
    await act(async () => {
      root.render(createElement(ExchangeProbe, { onState: () => {} }))
    })
    await flushAsyncWork()
    assert.equal(window.location.search, '')
  } finally {
    await act(async () => {
      root.unmount()
    })
    globalThis.fetch = originalFetch
    restoreDom()
  }
})

void test('useEmbeddedManagerPasscodeExchange reports failures and ignores updates after unmount', async () => {
  const restoreDom = installDomEnvironment()
  const originalFetch = globalThis.fetch
  let deferredFetch = createDeferred<Response>()
  globalThis.fetch = (() => deferredFetch.promise) as typeof fetch
  const states: ExchangeState[] = []
  const root = createRoot(document.getElementById('root') as Element)

  try {
    await act(async () => {
      root.render(createElement(ExchangeProbe, { onState: (state) => states.push(state) }))
    })
    await flushAsyncWork()
    deferredFetch.reject(new Error('exchange unavailable'))
    await flushAsyncWork()
    assert.equal(states.at(-1)?.isResolving, false)
    assert.equal((states.at(-1)?.error as Error).message, 'exchange unavailable')
    assert.equal(window.location.search, '')

    await act(async () => {
      root.unmount()
    })

    const cancellationStates: ExchangeState[] = []
    const cancellationRoot = createRoot(document.getElementById('root') as Element)
    deferredFetch = createDeferred<Response>()
    await act(async () => {
      cancellationRoot.render(createElement(ExchangeProbe, { onState: (state) => cancellationStates.push(state) }))
    })
    await flushAsyncWork()
    const stateCountBeforeUnmount = cancellationStates.length
    await act(async () => {
      cancellationRoot.unmount()
    })
    deferredFetch.reject(new Error('late failure'))
    await flushAsyncWork()
    assert.equal(cancellationStates.length, stateCountBeforeUnmount)
  } finally {
    globalThis.fetch = originalFetch
    restoreDom()
  }
})

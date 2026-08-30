import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'

;(globalThis as { React?: typeof React }).React = React

type TestingLibraryAct = (callback: () => void | Promise<void>) => void | Promise<void>

class TestWebSocket {
  static instances: TestWebSocket[] = []
  readyState = 1
  onopen: ((...a: unknown[]) => void) | null = null
  onmessage: ((...a: unknown[]) => void) | null = null
  onclose: ((...a: unknown[]) => void) | null = null
  onerror: ((...a: unknown[]) => void) | null = null

  constructor(readonly url: string) {
    TestWebSocket.instances.push(this)
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void { this.readyState = 3 }
}

function installDomEnvironment(url: string) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  const g = globalThis as Record<string, unknown>
  const saved = {
    window: g.window, document: g.document, HTMLElement: g.HTMLElement, Node: g.Node,
    WebSocket: g.WebSocket, localStorage: g.localStorage, sessionStorage: g.sessionStorage,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  }
  g.window = dom.window
  g.document = dom.window.document
  g.HTMLElement = dom.window.HTMLElement
  g.Node = dom.window.Node
  g.WebSocket = TestWebSocket
  g.localStorage = dom.window.localStorage
  g.sessionStorage = dom.window.sessionStorage
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: dom.window.navigator })

  return () => {
    dom.window.close()
    g.window = saved.window
    g.document = saved.document
    g.HTMLElement = saved.HTMLElement
    g.Node = saved.Node
    g.WebSocket = saved.WebSocket
    g.localStorage = saved.localStorage
    g.sessionStorage = saved.sessionStorage
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator)
    else delete g.navigator
  }
}

void test('JavaFormatPractice waits for the entry-participant consume before opening the socket', { concurrency: false }, async () => {
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/session-1')
  const previousFetch = globalThis.fetch
  const sessionId = 'session-1'

  const storage = await import('@src/components/common/entryParticipantStorage.js')
  const identityUtils = await import('@src/components/common/entryParticipantIdentityUtils.js')

  // The waiting room leaves a synchronous local context (so nameSubmitted is true
  // on the first render) plus a handoff token that must be consumed to mint the
  // participant cookie.
  identityUtils.persistSessionParticipantIdentity(window.localStorage, sessionId, 'Ada', 'student-a')
  storage.persistEntryParticipantToken(
    window.sessionStorage,
    storage.buildSessionEntryParticipantStorageKey('java-format-practice', sessionId),
    'handoff-token-1',
  )

  let resolveConsume: ((response: Response) => void) | null = null
  const consume = new Promise<Response>((resolve) => { resolveConsume = resolve })
  let consumeCalls = 0

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const requestUrl = String(input)
    if (requestUrl.includes('/entry-participant/consume')) {
      consumeCalls += 1
      return consume
    }
    if (requestUrl.endsWith(`/api/session/${sessionId}/entry`)) {
      return new Response(JSON.stringify({ participantAuthenticated: true }), { status: 200 })
    }
    if (requestUrl.includes('/stats')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const testingLibrary = await import('@testing-library/react')
    const router = await import('react-router')
    const { default: JavaFormatPractice } = await import('./JavaFormatPractice.js')
    const act = testingLibrary.act as TestingLibraryAct

    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={[`/${sessionId}`]}>
        <JavaFormatPractice sessionData={{ sessionId }} />
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    // Let mount effects + queued microtasks run.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    assert.equal(consumeCalls, 1, 'the handoff consume was attempted')
    assert.equal(TestWebSocket.instances.length, 0, 'no socket is opened before the consume resolves')

    await act(async () => {
      resolveConsume?.(new Response(JSON.stringify({ values: { participantId: 'student-a', displayName: 'Ada' } }), { status: 200 }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await testingLibrary.waitFor(() => { assert.equal(TestWebSocket.instances.length, 1) })
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPractice does not open the socket when the entry-participant consume fails', { concurrency: false }, async () => {
  console.info('[TEST] java-format student: entry-participant consume 500 + failed auth verification are expected below')
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/session-fail')
  const previousFetch = globalThis.fetch
  const sessionId = 'session-fail'

  const storage = await import('@src/components/common/entryParticipantStorage.js')
  const identityUtils = await import('@src/components/common/entryParticipantIdentityUtils.js')

  identityUtils.persistSessionParticipantIdentity(window.localStorage, sessionId, 'Ada', 'student-a')
  const handoffKey = storage.buildSessionEntryParticipantStorageKey('java-format-practice', sessionId)
  storage.persistEntryParticipantToken(window.sessionStorage, handoffKey, 'handoff-token-fail')

  let consumeCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const requestUrl = String(input)
    if (requestUrl.includes('/entry-participant/consume')) {
      consumeCalls += 1
      // Transient server error: the helper leaves the handoff token in place.
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
    }
    if (requestUrl.endsWith(`/api/session/${sessionId}/entry`)) {
      // No participant cookie was minted, so the server does not authenticate it.
      return new Response(JSON.stringify({ sessionId }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const testingLibrary = await import('@testing-library/react')
    const router = await import('react-router')
    const { default: JavaFormatPractice } = await import('./JavaFormatPractice.js')
    const act = testingLibrary.act as TestingLibraryAct

    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={[`/${sessionId}`]}>
        <JavaFormatPractice sessionData={{ sessionId }} />
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    assert.equal(consumeCalls, 1, 'the consume was attempted')
    assert.ok(
      storage.hasStoredEntryParticipantToken(window.sessionStorage, handoffKey),
      'a failed consume leaves the handoff token pending',
    )
    assert.equal(TestWebSocket.instances.length, 0, 'the socket stays closed so there is no 1008 -> reload loop')
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPractice does not open the socket for a local kind:values handoff with no server cookie', { concurrency: false }, async () => {
  console.info('[TEST] java-format student: unauthenticated /entry response for a local kind:values fallback is expected below')
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/session-values')
  const previousFetch = globalThis.fetch
  const sessionId = 'session-values'

  const storage = await import('@src/components/common/entryParticipantStorage.js')
  const identityUtils = await import('@src/components/common/entryParticipantIdentityUtils.js')

  identityUtils.persistSessionParticipantIdentity(window.localStorage, sessionId, 'Ada', 'student-a')
  // The waiting room's local fallback when the server store request failed: a
  // `kind: 'values'` handoff that resolves locally without minting any cookie.
  storage.persistEntryParticipantValues(
    window.sessionStorage,
    storage.buildSessionEntryParticipantStorageKey('java-format-practice', sessionId),
    { participantId: 'student-a', displayName: 'Ada' },
  )

  let entryChecks = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const requestUrl = String(input)
    if (requestUrl.endsWith(`/api/session/${sessionId}/entry`)) {
      entryChecks += 1
      return new Response(JSON.stringify({ sessionId }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const testingLibrary = await import('@testing-library/react')
    const router = await import('react-router')
    const { default: JavaFormatPractice } = await import('./JavaFormatPractice.js')
    const act = testingLibrary.act as TestingLibraryAct

    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={[`/${sessionId}`]}>
        <JavaFormatPractice sessionData={{ sessionId }} />
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    assert.ok(entryChecks >= 1, 'server authentication was verified')
    assert.equal(TestWebSocket.instances.length, 0, 'the local-values fallback does not open the socket')
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

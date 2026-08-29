import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'

;(globalThis as { React?: typeof React }).React = React

type SocketHandler = ((event: unknown) => void) | null
type TestingLibraryAct = (callback: () => void | Promise<void>) => void | Promise<void>

class TestWebSocket {
  static instances: TestWebSocket[] = []
  readyState = 1
  onopen: SocketHandler = null
  onmessage: SocketHandler = null
  onclose: SocketHandler = null
  onerror: SocketHandler = null

  constructor(readonly url: string) {
    TestWebSocket.instances.push(this)
  }

  send(): void {}
  close(): void {
    this.readyState = 3
    this.onclose?.({ code: 1000, reason: '' })
  }
}

function installDomEnvironment(url: string) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousHTMLElement = globalThis.HTMLElement
  const previousNode = globalThis.Node
  const previousWebSocket = globalThis.WebSocket

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: dom.window.navigator })
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Node = dom.window.Node
  globalThis.WebSocket = TestWebSocket as unknown as typeof WebSocket
  dom.window.WebSocket = TestWebSocket as unknown as typeof WebSocket

  return () => {
    globalThis.document?.body?.replaceChildren()
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    globalThis.HTMLElement = previousHTMLElement
    globalThis.Node = previousNode
    globalThis.WebSocket = previousWebSocket
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

function studentRecord(id: string, name: string) {
  return { id, name, connected: true, joined: 1, lastSeen: 1, stats: { total: 0, correct: 0, streak: 0, longestStreak: 0 } }
}

async function renderManager(path: string) {
  const testingLibrary = await import('@testing-library/react')
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: JavaFormatPracticeManager } = await import('./JavaFormatPracticeManager.js')
  const act = testingLibrary.act as TestingLibraryAct

  const rendered = testingLibrary.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
      </Routes>
    </MemoryRouter>,
  )

  const teardown = async () => {
    await act(async () => {
      rendered.unmount()
      testingLibrary.cleanup()
      await Promise.resolve()
    })
  }

  return { rendered, act, waitFor: testingLibrary.waitFor, teardown }
}

void test('JavaFormatPracticeManager keeps a live studentsUpdate over a slower /students poll', { concurrency: false }, async () => {
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/session-1')
  const previousFetch = globalThis.fetch

  let resolveInitialRoster: ((response: Response) => void) | null = null
  const initialRoster = new Promise<Response>((resolve) => { resolveInitialRoster = resolve })
  let studentsCalls = 0

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/students')) {
      studentsCalls += 1
      // The mount poll is deliberately slow so a socket update can land before it
      // resolves; any later poll just echoes the current roster.
      if (studentsCalls === 1) return initialRoster
      return new Response(JSON.stringify({ students: [studentRecord('b', 'Bea')] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { rendered, act, waitFor, teardown: dispose } = await renderManager('/manage/java-format-practice/session-1')
    teardown = dispose

    await waitFor(() => { assert.ok(TestWebSocket.instances.length >= 1) })

    // A live studentsUpdate arrives while the mount poll is still in flight.
    await act(async () => {
      TestWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({ type: 'studentsUpdate', payload: { students: [studentRecord('a', 'Ada')] } }),
      })
      await Promise.resolve()
    })
    await waitFor(() => { assert.ok(rendered.queryByText('Ada')) })

    // The now-stale poll resolves last with a different roster; it must be dropped.
    await act(async () => {
      resolveInitialRoster?.(new Response(JSON.stringify({ students: [studentRecord('b', 'Bea')] }), { status: 200 }))
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.ok(rendered.queryByText('Ada'), 'the socket roster is retained')
    assert.equal(rendered.queryByText('Bea'), null, 'the stale poll response is discarded')
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager applies the /students poll when no socket update supersedes it', { concurrency: false }, async () => {
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/session-2')
  const previousFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/students')) {
      return new Response(JSON.stringify({ students: [studentRecord('c', 'Cass')] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { rendered, waitFor, teardown: dispose } = await renderManager('/manage/java-format-practice/session-2')
    teardown = dispose
    await waitFor(() => { assert.ok(rendered.queryByText('Cass')) })
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

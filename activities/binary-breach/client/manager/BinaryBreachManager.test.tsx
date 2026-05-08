import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'

;(globalThis as { React?: typeof React }).React = React

type TestingLibraryAct = (callback: () => void | Promise<void>) => void | Promise<void>

function installDomEnvironment(url: string) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousHTMLElement = globalThis.HTMLElement
  const previousNode = globalThis.Node
  const previousWebSocket = globalThis.WebSocket

  class TestWebSocket {
    onmessage: ((event: MessageEvent) => void) | null = null

    constructor(readonly url: string) {}

    close(): void {}
  }

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  })
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

void test('BinaryBreachManager applies query settings once per managed session id', { concurrency: false }, async () => {
  const restoreDom = installDomEnvironment('https://bits.example/manage/binary-breach/session-one?maxBits=4')
  const previousFetch = globalThis.fetch
  const settingsPosts: Array<{ url: string, body: unknown }> = []

  globalThis.fetch = (async (input, init) => {
    const url = String(input)

    if (url.endsWith('/state')) {
      return new Response(JSON.stringify({
        settings: {
          maxBits: 8,
          missionLength: 5,
          challengeTypes: ['binary-to-decimal', 'decimal-to-binary', 'compare-binary', 'order-binary'],
          hintsEnabled: true,
          placeValueSupport: 'visible',
        },
        students: [],
      }), { status: 200 })
    }

    if (url.endsWith('/settings')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null
      settingsPosts.push({ url, body })
      return new Response(JSON.stringify({ settings: body }), { status: 200 })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let cleanup: (() => void) | null = null
  let unmount: (() => void) | null = null
  let act: TestingLibraryAct | null = null

  try {
    const testingLibrary = await import('@testing-library/react')
    const { fireEvent, render, waitFor } = testingLibrary
    cleanup = testingLibrary.cleanup
    act = testingLibrary.act
    const { MemoryRouter, Route, Routes, useNavigate } = await import('react-router-dom')
    const { default: BinaryBreachManager } = await import('./BinaryBreachManager.js')

    function NavigationProbe(): React.JSX.Element {
      const navigate = useNavigate()
      return (
        <>
          <BinaryBreachManager />
          <button
            type="button"
            onClick={() => navigate('/manage/binary-breach/session-two?maxBits=6')}
          >
            Go to next session
          </button>
        </>
      )
    }

    const rendered = render(
      <MemoryRouter initialEntries={['/manage/binary-breach/session-one?maxBits=4']}>
        <Routes>
          <Route path="/manage/binary-breach/:sessionId" element={<NavigationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount = rendered.unmount

    await waitFor(() => {
      assert.equal(settingsPosts.length, 1)
    })
    assert.equal(settingsPosts[0]?.url, '/api/binary-breach/session-one/settings')
    assert.deepEqual(settingsPosts[0]?.body, {
      maxBits: 4,
      missionLength: 5,
      challengeTypes: ['binary-to-decimal', 'decimal-to-binary', 'compare-binary', 'order-binary'],
      timerMode: 'off',
      hintsEnabled: true,
      placeValueSupport: 'visible',
    })

    fireEvent.click(rendered.getByRole('button', { name: /go to next session/i }))

    await waitFor(() => {
      assert.equal(settingsPosts.length, 2)
    })
    assert.equal(settingsPosts[1]?.url, '/api/binary-breach/session-two/settings')
    assert.deepEqual(settingsPosts[1]?.body, {
      maxBits: 6,
      missionLength: 5,
      challengeTypes: ['binary-to-decimal', 'decimal-to-binary', 'compare-binary', 'order-binary'],
      timerMode: 'off',
      hintsEnabled: true,
      placeValueSupport: 'visible',
    })

  } finally {
    if (act) {
      await act(async () => {
        unmount?.()
        cleanup?.()
        await Promise.resolve()
      })
    } else {
      unmount?.()
      cleanup?.()
      await Promise.resolve()
    }
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment(url: string) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousHTMLElement = globalThis.HTMLElement
  const previousNode = globalThis.Node

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  })
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Node = dom.window.Node

  return () => {
    globalThis.document?.body?.replaceChildren()
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    globalThis.HTMLElement = previousHTMLElement
    globalThis.Node = previousNode
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

void test('ManagedSessionRoute redirects to session-ended when the managed session is missing', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/manage/syncdeck/session-1')
  const previousFetch = globalThis.fetch
  let fetchCallCount = 0
  let lastFetchInit: RequestInit | undefined

  globalThis.fetch = (async (_input, init) => {
    fetchCallCount += 1
    lastFetchInit = init
    return new Response(null, { status: 404 })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const { render, waitFor, cleanup } = await import('@testing-library/react')
  const { MemoryRouter, Route, Routes } = await import('react-router-dom')
  const { default: ManagedSessionRoute } = await import('./ManagedSessionRoute')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/manage/syncdeck/session-1']}>
        <Routes>
          <Route
            path="/manage/:activityId/:sessionId"
            element={(
              <ManagedSessionRoute>
                <div>Manager view</div>
              </ManagedSessionRoute>
            )}
          />
          <Route path="/session-ended" element={<div>Session ended route</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      assert.equal(rendered.getByText('Session ended route').textContent, 'Session ended route')
    })
    assert.equal(fetchCallCount >= 1, true)
    assert.equal(lastFetchInit?.cache, 'no-store')
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('ManagedSessionRoute renders normally without a session id route param', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/manage/syncdeck')
  const previousFetch = globalThis.fetch
  let fetchCallCount = 0

  globalThis.fetch = (async () => {
    fetchCallCount += 1
    return new Response(JSON.stringify({ session: {} }), { status: 200 })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const { render, cleanup } = await import('@testing-library/react')
  const { MemoryRouter, Route, Routes } = await import('react-router-dom')
  const { default: ManagedSessionRoute } = await import('./ManagedSessionRoute.js')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/manage/syncdeck']}>
        <Routes>
          <Route
            path="/manage/:activityId"
            element={(
              <ManagedSessionRoute>
                <div>Manager dashboard view</div>
              </ManagedSessionRoute>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    assert.equal(rendered.getByText('Manager dashboard view').textContent, 'Manager dashboard view')
    assert.equal(fetchCallCount, 0)
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('ManagedSessionRoute stays on the manager page for transient server errors', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/manage/syncdeck/session-1')
  const previousFetch = globalThis.fetch
  let fetchCallCount = 0

  globalThis.fetch = (async () => {
    fetchCallCount += 1
    return new Response(null, { status: 500 })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const { render, waitFor, cleanup } = await import('@testing-library/react')
  const { MemoryRouter, Route, Routes } = await import('react-router-dom')
  const { default: ManagedSessionRoute } = await import('./ManagedSessionRoute.js')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/manage/syncdeck/session-1']}>
        <Routes>
          <Route
            path="/manage/:activityId/:sessionId"
            element={(
              <ManagedSessionRoute>
                <div>Manager view</div>
              </ManagedSessionRoute>
            )}
          />
          <Route path="/session-ended" element={<div>Session ended route</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      assert.equal(fetchCallCount >= 1, true)
    })
    assert.equal(rendered.getByText('Manager view').textContent, 'Manager view')
    assert.equal(rendered.queryByText('Session ended route'), null)
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('ManagedSessionRoute stays on the manager page for network failures', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/manage/syncdeck/session-1')
  const previousFetch = globalThis.fetch
  let fetchCallCount = 0

  globalThis.fetch = (async () => {
    fetchCallCount += 1
    throw new Error('network down')
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const { render, waitFor, cleanup } = await import('@testing-library/react')
  const { MemoryRouter, Route, Routes } = await import('react-router-dom')
  const { default: ManagedSessionRoute } = await import('./ManagedSessionRoute.js')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/manage/syncdeck/session-1']}>
        <Routes>
          <Route
            path="/manage/:activityId/:sessionId"
            element={(
              <ManagedSessionRoute>
                <div>Manager view</div>
              </ManagedSessionRoute>
            )}
          />
          <Route path="/session-ended" element={<div>Session ended route</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      assert.equal(fetchCallCount >= 1, true)
    })
    assert.equal(rendered.getByText('Manager view').textContent, 'Manager view')
    assert.equal(rendered.queryByText('Session ended route'), null)
  } finally {
    cleanup()
    restoreDom()
  }
})

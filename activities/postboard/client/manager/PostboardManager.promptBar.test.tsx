import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import type { PostboardInstructorSnapshot } from '../../shared/types.js'

;(globalThis as { React?: typeof React }).React = React

type TestingLibraryAct = (callback: () => void | Promise<void>) => void | Promise<void>

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

function buildSnapshot(promptText: string): PostboardInstructorSnapshot {
  return {
    prompt: { id: 'prompt-1', text: promptText, createdAt: 0, updatedAt: 0 },
    settings: { autoApprove: false },
    posts: [],
    reactionCounts: {},
    viewerReactions: {},
    flags: {},
  }
}

void test('PostboardManager prompt bar toggle opens and closes the inline editor with correct aria state', { concurrency: false }, async () => {
  const restoreDom = installDomEnvironment('https://bits.example/manage/postboard/session-1')
  const previousFetch = globalThis.fetch
  const snapshot = buildSnapshot('')

  globalThis.fetch = (async (input) => {
    const url = String(input)
    if (url.endsWith('/instructor-state')) {
      return new Response(JSON.stringify(snapshot), { status: 200 })
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
    const { MemoryRouter, Route, Routes } = await import('react-router')
    const { default: PostboardManager } = await import('./PostboardManager.js')

    const rendered = render(
      <MemoryRouter initialEntries={[{ pathname: '/manage/postboard/session-1', state: { instructorPasscode: 'pw-1' } }]}>
        <Routes>
          <Route path="/manage/postboard/:sessionId" element={<PostboardManager />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount = rendered.unmount

    // No prompt is set yet, so the editor should open automatically.
    await waitFor(() => {
      assert.notEqual(rendered.container.querySelector('#postboard-setup-form'), null)
    })

    const toggleButton = rendered.getByRole('button', { name: /close prompt editor/i })
    assert.equal(toggleButton.getAttribute('aria-expanded'), 'true')

    fireEvent.click(toggleButton)

    await waitFor(() => {
      assert.equal(rendered.container.querySelector('#postboard-setup-form'), null)
    })
    const reopenButton = rendered.getByRole('button', { name: /edit prompt/i })
    assert.equal(reopenButton.getAttribute('aria-expanded'), 'false')
    assert.ok(rendered.container.textContent?.includes('No prompt set'))

    fireEvent.click(reopenButton)

    await waitFor(() => {
      assert.notEqual(rendered.container.querySelector('#postboard-setup-form'), null)
    })
    assert.equal(rendered.getByRole('button', { name: /close prompt editor/i }).getAttribute('aria-expanded'), 'true')
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
    }
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('PostboardManager saves the prompt and renders the saved text in the prompt bar', { concurrency: false }, async () => {
  const restoreDom = installDomEnvironment('https://bits.example/manage/postboard/session-1')
  const previousFetch = globalThis.fetch
  let snapshot = buildSnapshot('')
  const setupPosts: Array<{ url: string, body: unknown }> = []

  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    if (url.endsWith('/instructor-state')) {
      return new Response(JSON.stringify(snapshot), { status: 200 })
    }
    if (url.endsWith('/setup')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { prompt: string, autoApprove: boolean } : null
      setupPosts.push({ url, body })
      snapshot = buildSnapshot(body?.prompt ?? '')
      return new Response(JSON.stringify(snapshot), { status: 200 })
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
    const { MemoryRouter, Route, Routes } = await import('react-router')
    const { default: PostboardManager } = await import('./PostboardManager.js')

    const rendered = render(
      <MemoryRouter initialEntries={[{ pathname: '/manage/postboard/session-1', state: { instructorPasscode: 'pw-1' } }]}>
        <Routes>
          <Route path="/manage/postboard/:sessionId" element={<PostboardManager />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount = rendered.unmount

    await waitFor(() => {
      assert.notEqual(rendered.container.querySelector('#postboard-setup-form'), null)
    })

    const textarea = rendered.container.querySelector('#postboard-setup-form textarea')
    assert.notEqual(textarea, null)
    fireEvent.change(textarea as HTMLTextAreaElement, { target: { value: 'What did you learn today?' } })
    fireEvent.click(rendered.getByRole('button', { name: /save prompt/i }))

    await waitFor(() => {
      assert.equal(setupPosts.length, 1)
    })
    assert.deepEqual(setupPosts[0]?.body, { prompt: 'What did you learn today?', autoApprove: false })

    // A non-empty prompt closes the editor and the saved text renders in the bar.
    await waitFor(() => {
      assert.equal(rendered.container.querySelector('#postboard-setup-form'), null)
    })
    await waitFor(() => {
      assert.ok(rendered.container.querySelector('.postboard-prompt-bar-text')?.textContent?.includes('What did you learn today?'))
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
    }
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

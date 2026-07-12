import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { buildSessionEntryParticipantStorageKey } from '@src/components/common/entryParticipantStorage'

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

void test('submitting a note refreshes the board even while student identity resolution is still pending', { concurrency: false }, async () => {
  const restoreDom = installDomEnvironment('https://bits.example/postboard/session-1')
  const previousFetch = globalThis.fetch
  let studentStateFetchCount = 0
  const consumeControl: { resolve: ((response: Response) => void) | null } = { resolve: null }
  const consumeResponse = new Promise<Response>((resolve) => {
    consumeControl.resolve = resolve
  })

  // Seed a pending entry-participant "token" handoff so identity resolution stalls on a
  // network round trip that this test controls and never resolves during the assertions below.
  window.sessionStorage.setItem(
    buildSessionEntryParticipantStorageKey('postboard', 'session-1'),
    JSON.stringify({ kind: 'token', token: 'test-token' }),
  )

  globalThis.fetch = (async (input, init) => {
    const url = String(input)

    if (url.includes('/entry-participant/consume')) {
      return consumeResponse
    }

    if (url.includes('/student-state')) {
      studentStateFetchCount += 1
      return new Response(JSON.stringify({
        prompt: { text: 'Prompt' },
        posts: [{ id: 'post-1', text: 'Hello there', styleId: 'default', status: 'pending', isOwnPost: true }],
        reactionCounts: {},
        viewerReactions: {},
      }), { status: 200 })
    }

    if (url.endsWith('/posts')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    throw new Error(`Unexpected fetch: ${url} ${String(init?.method)}`)
  }) as typeof fetch

  let cleanup: (() => void) | null = null
  let unmount: (() => void) | null = null
  let act: TestingLibraryAct | null = null

  try {
    const testingLibrary = await import('@testing-library/react')
    const { fireEvent, render, waitFor } = testingLibrary
    cleanup = testingLibrary.cleanup
    act = testingLibrary.act
    const { default: PostboardStudent } = await import('./PostboardStudent.js')

    const rendered = render(
      <PostboardStudent sessionData={{ sessionId: 'session-1', studentId: 'stu-1', studentName: 'Ada' }} />,
    )
    unmount = rendered.unmount

    const textarea = rendered.container.querySelector('textarea')
    assert.notEqual(textarea, null)
    fireEvent.change(textarea as HTMLTextAreaElement, { target: { value: 'Hello there' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit note/i }))

    // The identity-resolution consume request never settles, so if the post-submit
    // refresh were still gated on identityResolved this would time out at zero fetches.
    await waitFor(() => {
      assert.equal(studentStateFetchCount, 1)
    })
    await waitFor(() => {
      assert.ok(rendered.container.textContent?.includes('Hello there'))
    })
  } finally {
    consumeControl.resolve?.(new Response(JSON.stringify({ values: {} }), { status: 200 }))
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

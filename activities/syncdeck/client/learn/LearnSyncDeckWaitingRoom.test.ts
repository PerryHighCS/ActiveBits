import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { readLearnSyncDeckWaitingStatus } from './learnSyncDeckWaitingUtils.js'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://bits.mycode.run/integrations/learn/syncdeck/wait' })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  ;(globalThis as { window: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: dom.window.navigator })

  return () => {
    globalThis.document?.body?.replaceChildren()
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    if (previousNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    else delete (globalThis as { navigator?: Navigator }).navigator
  }
}

void test('readLearnSyncDeckWaitingStatus returns an active launch URL without caching', async () => {
  let requestedUrl = ''
  let init: RequestInit | undefined
  const controller = new AbortController()
  const result = await readLearnSyncDeckWaitingStatus(async (input, options) => {
    requestedUrl = String(input)
    init = options
    return new Response(JSON.stringify({ state: 'active', studentLaunchUrl: '/session-1' }), { status: 200 })
  }, controller.signal)

  assert.deepEqual(result, { state: 'active', studentLaunchUrl: '/session-1' })
  assert.equal(requestedUrl, '/api/integrations/learn/v1/activities/syncdeck/wait/status')
  assert.equal(init?.cache, 'no-store')
  assert.equal(init?.credentials, 'same-origin')
  assert.equal(init?.signal, controller.signal)
})

void test('readLearnSyncDeckWaitingStatus surfaces a safe server error', async () => {
  console.info('[TEST] Expected unavailable Learn waiting-room entry error.')
  await assert.rejects(
    () => readLearnSyncDeckWaitingStatus(async () => new Response(JSON.stringify({ error: 'Waiting-room entry is unavailable' }), { status: 404 })),
    /waiting-room entry is unavailable/i,
  )
})

void test('readLearnSyncDeckWaitingStatus falls back to a safe error for a non-JSON response', async () => {
  console.info('[TEST] Expected non-JSON Learn waiting-room gateway error.')
  await assert.rejects(
    () => readLearnSyncDeckWaitingStatus(async () => new Response('<html>gateway error</html>', { status: 502 })),
    /waiting-room entry is no longer available/i,
  )
})

void test('readLearnSyncDeckWaitingStatus rejects unsafe student launch URLs', async () => {
  for (const studentLaunchUrl of ['https://untrusted.example/session', '//untrusted.example/session', '/\\untrusted.example/session']) {
    const result = await readLearnSyncDeckWaitingStatus(async () => new Response(JSON.stringify({
      state: 'active',
      studentLaunchUrl,
    })))

    assert.deepEqual(result, { state: 'active', studentLaunchUrl: null })
  }
})

void test('LearnSyncDeckWaitingRoom times out a stalled status request and enables retry', async () => {
  console.info('[TEST] Expected timed-out Learn waiting-room status request.')
  const restoreDomEnvironment = installDomEnvironment()
  const originalFetch = globalThis.fetch
  const originalSetTimeout = window.setTimeout
  const originalClearTimeout = window.clearTimeout
  const originalSetInterval = window.setInterval
  const originalClearInterval = window.clearInterval
  const scheduled: Array<() => void> = []
  ;(globalThis as { fetch: typeof fetch }).fetch = ((_, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal as AbortSignal | undefined
    signal?.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')), { once: true })
  })) as typeof fetch
  window.setTimeout = ((handler: TimerHandler) => {
    scheduled.push(() => {
      if (typeof handler === 'function') handler()
    })
    return scheduled.length as unknown as number
  }) as typeof window.setTimeout
  window.clearTimeout = (() => {}) as typeof window.clearTimeout
  window.setInterval = (() => 1) as unknown as typeof window.setInterval
  window.clearInterval = (() => {}) as typeof window.clearInterval

  try {
    const { render, waitFor } = await import('@testing-library/react')
    const { default: LearnSyncDeckWaitingRoom } = await import('./LearnSyncDeckWaitingRoom.js')
    const rendered = render(React.createElement(LearnSyncDeckWaitingRoom))
    while (scheduled.length > 0) scheduled.shift()?.()

    await waitFor(() => {
      assert.notEqual(rendered.queryByRole('button', { name: /try again/i }), null)
    })
    rendered.unmount()
  } finally {
    ;(globalThis as { fetch: typeof fetch }).fetch = originalFetch
    window.setTimeout = originalSetTimeout
    window.clearTimeout = originalClearTimeout
    window.setInterval = originalSetInterval
    window.clearInterval = originalClearInterval
    restoreDomEnvironment()
  }
})

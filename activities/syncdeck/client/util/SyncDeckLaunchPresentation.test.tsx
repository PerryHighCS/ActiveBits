import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment(url = 'https://bits.mycode.run/util/syncdeck/launch-presentation') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  ;(globalThis as { window: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  })

  return () => {
    globalThis.document?.body?.replaceChildren()
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

void test('launchHostedSyncDeckPresentation validates, creates, configures, stores passcode, and redirects', async () => {
  const { launchHostedSyncDeckPresentation } = await import('./SyncDeckLaunchPresentation.js')
  const requests: Array<{ input: string; init?: RequestInit }> = []
  const redirects: string[] = []
  const sessionStorageWrites = new Map<string, string>()

  const result = await launchHostedSyncDeckPresentation({
    presentationUrl: 'https://slides.example/deck',
    hostProtocol: 'https:',
    userAgent: 'Mozilla/5.0 Chrome/123.0.0.0 Safari/537.36',
    preflightRunner: async () => ({ valid: true, warning: null }),
    fetchFn: (async (input, init) => {
      requests.push({ input: String(input), init })
      if (String(input) === '/api/syncdeck/create') {
        return {
          ok: true,
          json: async () => ({
            id: 'syncdeck-utility-1',
            instructorPasscode: 'launch-passcode',
          }),
        } as Response
      }

      if (String(input) === '/api/syncdeck/syncdeck-utility-1/configure') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response
      }

      throw new Error(`[TEST] unexpected fetch: ${String(input)}`)
    }) as typeof fetch,
    sessionStorage: {
      setItem(key, value) {
        sessionStorageWrites.set(key, value)
      },
    },
    redirectTo(url) {
      redirects.push(url)
    },
  })

  assert.deepEqual(result, { sessionId: 'syncdeck-utility-1' })
  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.input, '/api/syncdeck/create')
  assert.equal(requests[1]?.input, '/api/syncdeck/syncdeck-utility-1/configure')
  assert.deepEqual(
    JSON.parse(String(requests[1]?.init?.body ?? '{}')),
    {
      presentationUrl: 'https://slides.example/deck',
      instructorPasscode: 'launch-passcode',
      standaloneMode: false,
    },
  )
  assert.equal(sessionStorageWrites.get('syncdeck_instructor_syncdeck-utility-1'), 'launch-passcode')
  assert.deepEqual(redirects, ['/manage/syncdeck/syncdeck-utility-1'])
})

void test('launchHostedSyncDeckPresentation rejects presentations that fail SyncDeck preflight', async () => {
  const { launchHostedSyncDeckPresentation } = await import('./SyncDeckLaunchPresentation.js')

  await assert.rejects(
    launchHostedSyncDeckPresentation({
      presentationUrl: 'https://slides.example/not-syncdeck',
      hostProtocol: 'https:',
      userAgent: 'Mozilla/5.0 Chrome/123.0.0.0 Safari/537.36',
      preflightRunner: async () => ({
        valid: false,
        warning: 'Presentation did not respond to sync ping in time. You can continue anyway.',
      }),
      fetchFn: (async () => {
        throw new Error('[TEST] fetch should not run when preflight fails')
      }) as typeof fetch,
    }),
    /did not respond to sync ping in time/i,
  )
})

void test('SyncDeckLaunchPresentation shows a missing-url error before launch starts', async () => {
  const restoreDomEnvironment = installDomEnvironment('https://bits.mycode.run/util/syncdeck/launch-presentation')
  const { render, waitFor } = await import('@testing-library/react')
  const { MemoryRouter } = await import('react-router-dom')
  const { default: SyncDeckLaunchPresentation } = await import('./SyncDeckLaunchPresentation.js')

  try {
    const rendered = render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: ['/util/syncdeck/launch-presentation'],
        },
        React.createElement(SyncDeckLaunchPresentation),
      ),
    )

    await waitFor(() => {
      assert.notEqual(rendered.queryByText(/missing required presentationurl query parameter/i), null)
    })
  } finally {
    restoreDomEnvironment()
  }
})

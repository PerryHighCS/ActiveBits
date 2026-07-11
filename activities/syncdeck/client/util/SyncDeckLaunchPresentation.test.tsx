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

void test('launchStandaloneSyncDeckPresentation validates, creates, configures, and redirects into solo mode', async () => {
  const { launchStandaloneSyncDeckPresentation } = await import('./SyncDeckLaunchPresentation.js')
  const requests: Array<{ input: string; init?: RequestInit }> = []
  const redirects: string[] = []

  const result = await launchStandaloneSyncDeckPresentation({
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
      standaloneMode: true,
    },
  )
  assert.deepEqual(redirects, ['/syncdeck-utility-1'])
})

void test('launchStandaloneSyncDeckPresentation rejects presentations that fail SyncDeck preflight', async () => {
  const { launchStandaloneSyncDeckPresentation } = await import('./SyncDeckLaunchPresentation.js')

  await assert.rejects(
    launchStandaloneSyncDeckPresentation({
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

void test('launchStandaloneSyncDeckPresentation can launch instructor mode from a presentation URL', async () => {
  const { launchStandaloneSyncDeckPresentation } = await import('./SyncDeckLaunchPresentation.js')
  const requests: Array<{ input: string; init?: RequestInit }> = []
  const redirects: Array<{ url: string; state: unknown }> = []

  const result = await launchStandaloneSyncDeckPresentation({
    presentationUrl: 'https://slides.example/deck?unit=arrays',
    mode: 'instructor',
    hostProtocol: 'https:',
    userAgent: 'Mozilla/5.0 Chrome/123.0.0.0 Safari/537.36',
    preflightRunner: async () => ({ valid: true, warning: null }),
    fetchFn: (async (input, init) => {
      requests.push({ input: String(input), init })
      if (String(input) === '/api/syncdeck/create') {
        return {
          ok: true,
          json: async () => ({
            id: 'syncdeck-instructor-1',
            instructorPasscode: 'launch-passcode',
          }),
        } as Response
      }

      if (String(input) === '/api/syncdeck/syncdeck-instructor-1/configure') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response
      }

      throw new Error(`[TEST] unexpected fetch: ${String(input)}`)
    }) as typeof fetch,
    redirectTo(url, state) {
      redirects.push({ url, state })
    },
  })

  assert.deepEqual(result, { sessionId: 'syncdeck-instructor-1' })
  assert.equal(requests[1]?.input, '/api/syncdeck/syncdeck-instructor-1/configure')
  assert.deepEqual(
    JSON.parse(String(requests[1]?.init?.body ?? '{}')),
    {
      presentationUrl: 'https://slides.example/deck?unit=arrays',
      instructorPasscode: 'launch-passcode',
      standaloneMode: false,
    },
  )
  assert.deepEqual(redirects, [
    {
      url: '/manage/syncdeck/syncdeck-instructor-1?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck%3Funit%3Darrays',
      state: {
        createSessionPayload: {
          instructorPasscode: 'launch-passcode',
        },
      },
    },
  ])
})

void test('generateSyncDeckPermalink posts selected presentation options and returns an absolute link', async () => {
  const { generateSyncDeckPermalink } = await import('./SyncDeckLaunchPresentation.js')
  const requests: Array<{ input: string; init?: RequestInit }> = []

  const result = await generateSyncDeckPermalink({
    presentationUrl: ' https://slides.example/deck ',
    teacherCode: ' teacher-123 ',
    origin: 'https://bits.example',
    fetchFn: (async (input, init) => {
      requests.push({ input: String(input), init })
      return {
        ok: true,
        json: async () => ({
          hash: 'abc123',
          url: '/activity/syncdeck/abc123?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck&urlHash=deadbeef',
        }),
      } as Response
    }) as typeof fetch,
  })

  assert.deepEqual(result, {
    hash: 'abc123',
    permalink: 'https://bits.example/activity/syncdeck/abc123?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck&urlHash=deadbeef',
  })
  assert.equal(requests[0]?.input, '/api/syncdeck/generate-url')
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body ?? '{}')), {
    activityName: 'syncdeck',
    teacherCode: 'teacher-123',
    selectedOptions: {
      presentationUrl: 'https://slides.example/deck',
    },
  })
})

void test('generateSyncDeckPermalink surfaces server validation errors', async () => {
  const { generateSyncDeckPermalink } = await import('./SyncDeckLaunchPresentation.js')

  await assert.rejects(
    generateSyncDeckPermalink({
      presentationUrl: 'https://slides.example/deck',
      teacherCode: 'short',
      fetchFn: (async () => ({
        ok: false,
        json: async () => ({ error: 'Teacher code must be at least 6 characters' }),
      } as Response)) as typeof fetch,
    }),
    /teacher code must be at least 6 characters/i,
  )
})

void test('copyTextToClipboard writes trimmed text to the clipboard', async () => {
  const { copyTextToClipboard } = await import('./SyncDeckLaunchPresentation.js')
  const writes: string[] = []

  await copyTextToClipboard(' https://bits.example/activity/syncdeck/abc123 ', {
    writeText: async (text) => {
      writes.push(text)
    },
  })

  assert.deepEqual(writes, ['https://bits.example/activity/syncdeck/abc123'])
})

void test('SyncDeckLaunchPresentation shows a launch form when presentationUrl is missing', async () => {
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
      assert.notEqual(rendered.queryByLabelText(/presentation url/i), null)
      assert.notEqual(rendered.queryByRole('button', { name: /launch solo in syncdeck/i }), null)
    })
  } finally {
    restoreDomEnvironment()
  }
})

void test('SyncDeckLaunchPresentation shows a permalink builder with a prefilled presentation URL', async () => {
  const restoreDomEnvironment = installDomEnvironment(
    'https://bits.mycode.run/util/syncdeck/permalink?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck',
  )
  const { render, waitFor } = await import('@testing-library/react')
  const { MemoryRouter } = await import('react-router-dom')
  const { default: SyncDeckLaunchPresentation } = await import('./SyncDeckLaunchPresentation.js')

  try {
    const rendered = render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [
            '/util/syncdeck/permalink?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck',
          ],
        },
        React.createElement(SyncDeckLaunchPresentation),
      ),
    )

    await waitFor(() => {
      assert.notEqual(rendered.queryByRole('heading', { name: /build permalink/i }), null)
      assert.equal(
        (rendered.getByLabelText(/presentation url/i) as HTMLInputElement).value,
        'https://slides.example/deck',
      )
      assert.notEqual(rendered.queryByLabelText(/teacher code/i), null)
      assert.notEqual(rendered.queryByRole('button', { name: /create permanent link/i }), null)
    })
  } finally {
    restoreDomEnvironment()
  }
})

void test('SyncDeckLaunchPresentation copies a generated permalink to the clipboard', async () => {
  const restoreDomEnvironment = installDomEnvironment(
    'https://bits.mycode.run/util/syncdeck/permalink?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck',
  )
  const previousFetch = globalThis.fetch
  const writes: string[] = []
  const { fireEvent, render, waitFor } = await import('@testing-library/react')
  const { MemoryRouter } = await import('react-router-dom')
  const { default: SyncDeckLaunchPresentation } = await import('./SyncDeckLaunchPresentation.js')

  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        writes.push(text)
      },
    },
  })
  ;(globalThis as { fetch: typeof fetch }).fetch = (async (input, init) => {
    assert.equal(String(input), '/api/syncdeck/generate-url')
    assert.equal(JSON.parse(String(init?.body ?? '{}')).teacherCode, 'teacher-123')
    return {
      ok: true,
      json: async () => ({
        hash: 'abc123',
        url: '/activity/syncdeck/abc123?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck&urlHash=deadbeef',
      }),
    } as Response
  }) as typeof fetch

  try {
    const rendered = render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [
            '/util/syncdeck/permalink?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck',
          ],
        },
        React.createElement(SyncDeckLaunchPresentation),
      ),
    )

    fireEvent.click(rendered.getByRole('button', { name: /verify url/i }))

    await waitFor(() => {
      assert.notEqual(document.querySelector('iframe'), null)
    })
    const iframe = document.querySelector('iframe')
    window.dispatchEvent(new window.MessageEvent('message', {
      origin: 'https://slides.example',
      source: iframe?.contentWindow ?? null,
      data: { type: 'reveal-sync', action: 'ready' },
    }))

    await waitFor(() => {
      assert.match(rendered.getByText(/url verified/i).textContent ?? '', /url verified/i)
    })

    fireEvent.change(rendered.getByLabelText(/teacher code/i), {
      target: { value: 'teacher-123' },
    })
    fireEvent.click(rendered.getByRole('button', { name: /create permanent link/i }))

    const generatedUrl = 'https://bits.mycode.run/activity/syncdeck/abc123?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck&urlHash=deadbeef'
    await waitFor(() => {
      assert.notEqual(rendered.queryByRole('link', { name: generatedUrl }), null)
      assert.notEqual(rendered.queryByRole('button', { name: /^copy$/i }), null)
    })

    fireEvent.click(rendered.getByRole('button', { name: /^copy$/i }))

    await waitFor(() => {
      assert.deepEqual(writes, [generatedUrl])
      assert.notEqual(rendered.queryByText(/copied link to clipboard/i), null)
    })
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('SyncDeckLaunchPresentation parses presentation-url alias and instructor mode', async () => {
  const {
    resolveSyncDeckLaunchMode,
    resolveSyncDeckLaunchPresentationUrl,
  } = await import('./SyncDeckLaunchPresentation.js')

  const params = new URLSearchParams(
    'presentation-url=https%3A%2F%2Fslides.example%2Fdeck&mode=instructor',
  )
  const paramsWithBlankCanonical = new URLSearchParams(
    'presentationUrl=%20%20%20&presentation-url=https%3A%2F%2Fslides.example%2Falias',
  )

  assert.equal(resolveSyncDeckLaunchPresentationUrl(params), 'https://slides.example/deck')
  assert.equal(resolveSyncDeckLaunchPresentationUrl(paramsWithBlankCanonical), 'https://slides.example/alias')
  assert.equal(resolveSyncDeckLaunchMode(params.get('mode')), 'instructor')
  assert.equal(resolveSyncDeckLaunchMode('student'), 'student')
  assert.equal(resolveSyncDeckLaunchMode('unexpected'), 'student')
})

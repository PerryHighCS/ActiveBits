import test from 'node:test'
import assert from 'node:assert/strict'
import type { ActivityRegistryEntry } from '../../../../types/activity.js'
import type { JSX } from 'react'
import { JSDOM } from 'jsdom'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import ActivityLauncher from './ActivityLauncher.js'

const videoSyncActivity: ActivityRegistryEntry = {
  id: 'video-sync',
  name: 'Video Sync',
  title: 'Video Sync',
  description: 'Synchronized YouTube playback for whole-class instruction',
  color: 'rose',
  standaloneEntry: {
    enabled: true,
  },
  deepLinkOptions: {
    sourceUrl: {
      label: 'YouTube URL',
      type: 'text',
      validator: 'url',
    },
  },
  createSessionBootstrap: {
    historyState: ['instructorPasscode'],
  },
  ManagerComponent: (() => null),
}

const instructorManagedOnlyActivity: ActivityRegistryEntry = {
  ...videoSyncActivity,
  id: 'raffle',
  name: 'Raffle',
  title: 'Raffle',
  standaloneEntry: {
    enabled: false,
  },
}

function installDomEnvironment(url: string) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document
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

function ManagedRouteProbe(): JSX.Element {
  const params = useParams()
  const location = useLocation()
  const state = location.state as { createSessionPayload?: { instructorPasscode?: unknown } } | null
  const instructorPasscode = typeof state?.createSessionPayload?.instructorPasscode === 'string'
    ? state.createSessionPayload.instructorPasscode
    : ''

  return (
    <div>
      Managed {params.activityId} {params.sessionId} {location.search} {instructorPasscode}
    </div>
  )
}

function LaunchRouteNavigator(): JSX.Element {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => {
        void navigate('/launch/raffle?start=1')
      }}
    >
      Go to raffle launcher
    </button>
  )
}

void test('ActivityLauncher auto-starts when start=1 and redirects with selected query options', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/launch/video-sync?start=1&sourceUrl=https%3A%2F%2Fyoutu.be%2Fabc123')
  const previousFetch = globalThis.fetch
  const fetchCalls: Array<{ input: RequestInfo | URL, init?: RequestInit }> = []

  globalThis.fetch = (async (input, init) => {
    fetchCalls.push({ input, init })
    return new Response(JSON.stringify({ id: 'session-1', instructorPasscode: 'pass-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
    restoreDom()
  })

  const { cleanup, render, waitFor } = await import('@testing-library/react')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/launch/video-sync?start=1&sourceUrl=https%3A%2F%2Fyoutu.be%2Fabc123']}>
        <Routes>
          <Route path="/launch/:activityId" element={<ActivityLauncher activityRegistry={[videoSyncActivity]} />} />
          <Route path="/manage/:activityId/:sessionId" element={<ManagedRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      assert.equal(fetchCalls.length, 1)
      assert.notEqual(rendered.queryByText(/Managed video-sync session-1/i), null)
    })
    assert.equal(fetchCalls[0]?.input, '/api/video-sync/create')
    assert.match(rendered.getByText(/Managed video-sync session-1/).textContent ?? '', /sourceUrl=https%3A%2F%2Fyoutu.be%2Fabc123/)
    assert.match(rendered.getByText(/Managed video-sync session-1/).textContent ?? '', /pass-1/)
  } finally {
    cleanup()
  }
})

void test('ActivityLauncher waits for manual start when start=1 is absent', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/launch/video-sync?sourceUrl=https%3A%2F%2Fyoutu.be%2Fabc123')
  const previousFetch = globalThis.fetch
  const fetchCalls: string[] = []

  globalThis.fetch = (async (input) => {
    fetchCalls.push(String(input))
    return new Response(JSON.stringify({ id: 'session-2' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
    restoreDom()
  })

  const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/launch/video-sync?sourceUrl=https%3A%2F%2Fyoutu.be%2Fabc123']}>
        <Routes>
          <Route path="/launch/:activityId" element={<ActivityLauncher activityRegistry={[videoSyncActivity]} />} />
          <Route path="/manage/:activityId/:sessionId" element={<ManagedRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    assert.equal(fetchCalls.length, 0)
    fireEvent.click(rendered.getByRole('button', { name: /start session/i }))

    await waitFor(() => {
      assert.equal(fetchCalls.length, 1)
      assert.notEqual(rendered.queryByText(/Managed video-sync session-2/i), null)
    })
  } finally {
    cleanup()
  }
})

void test('ActivityLauncher ignores rapid double-clicks while a session create request is in flight', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/launch/video-sync')
  const previousFetch = globalThis.fetch
  const fetchCalls: string[] = []
  let resolveRequest!: (response: Response) => void

  globalThis.fetch = (async (input) => {
    fetchCalls.push(String(input))
    return await new Promise<Response>((resolve) => {
      resolveRequest = resolve
    })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
    restoreDom()
  })

  const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/launch/video-sync']}>
        <Routes>
          <Route path="/launch/:activityId" element={<ActivityLauncher activityRegistry={[videoSyncActivity]} />} />
          <Route path="/manage/:activityId/:sessionId" element={<ManagedRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    const startButton = rendered.getByRole('button', { name: /start session/i })
    fireEvent.click(startButton)
    fireEvent.click(startButton)

    await waitFor(() => {
      assert.deepEqual(fetchCalls, ['/api/video-sync/create'])
    })

    resolveRequest(
      new Response(JSON.stringify({ id: 'session-double-click' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await waitFor(() => {
      assert.notEqual(rendered.queryByText(/Managed video-sync session-double-click/i), null)
    })
  } finally {
    cleanup()
  }
})

void test('ActivityLauncher blocks invalid launch options before creating a session', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/launch/video-sync?start=1&sourceUrl=not-a-url')
  const previousFetch = globalThis.fetch
  let fetchCallCount = 0

  globalThis.fetch = (async () => {
    fetchCallCount += 1
    return new Response(JSON.stringify({ id: 'session-3' }), { status: 200 })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
    restoreDom()
  })

  const { cleanup, render } = await import('@testing-library/react')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/launch/video-sync?start=1&sourceUrl=not-a-url']}>
        <Routes>
          <Route path="/launch/:activityId" element={<ActivityLauncher activityRegistry={[videoSyncActivity]} />} />
        </Routes>
      </MemoryRouter>,
    )

    assert.notEqual(rendered.queryByText(/YouTube URL must be a valid http\(s\) URL/i), null)
    assert.equal((rendered.getByRole('button', { name: /start session/i }) as HTMLButtonElement).disabled, true)
    assert.equal(fetchCallCount, 0)
  } finally {
    cleanup()
  }
})

void test('ActivityLauncher still starts instructor-managed activities when standalone entry is disabled', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/launch/raffle?start=1')
  const previousFetch = globalThis.fetch
  const fetchCalls: string[] = []

  globalThis.fetch = (async (input) => {
    fetchCalls.push(String(input))
    return new Response(JSON.stringify({ id: 'session-raffle' }), { status: 200 })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
    restoreDom()
  })

  const { cleanup, render } = await import('@testing-library/react')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/launch/raffle?start=1']}>
        <Routes>
          <Route path="/launch/:activityId" element={<ActivityLauncher activityRegistry={[instructorManagedOnlyActivity]} />} />
          <Route path="/manage/:activityId/:sessionId" element={<ManagedRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    const { waitFor } = await import('@testing-library/react')
    await waitFor(() => {
      assert.deepEqual(fetchCalls, ['/api/raffle/create'])
      assert.notEqual(rendered.queryByText(/Managed raffle session-raffle/i), null)
    })
  } finally {
    cleanup()
  }
})

void test('ActivityLauncher resets launch state when navigating between launcher URLs in one SPA session', async (t) => {
  const restoreDom = installDomEnvironment('https://bits.example/launch/video-sync?start=1&sourceUrl=not-a-url')
  const previousFetch = globalThis.fetch
  const fetchCalls: string[] = []

  globalThis.fetch = (async (input) => {
    fetchCalls.push(String(input))
    return new Response(JSON.stringify({ id: 'session-raffle-2' }), { status: 200 })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = previousFetch
    restoreDom()
  })

  const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    const rendered = render(
      <MemoryRouter initialEntries={['/launch/video-sync?start=1&sourceUrl=not-a-url']}>
        <LaunchRouteNavigator />
        <Routes>
          <Route
            path="/launch/:activityId"
            element={<ActivityLauncher activityRegistry={[videoSyncActivity, instructorManagedOnlyActivity]} />}
          />
          <Route path="/manage/:activityId/:sessionId" element={<ManagedRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    assert.notEqual(rendered.queryByText(/YouTube URL must be a valid http\(s\) URL/i), null)
    assert.deepEqual(fetchCalls, [])

    fireEvent.click(rendered.getByRole('button', { name: /go to raffle launcher/i }))

    await waitFor(() => {
      assert.deepEqual(fetchCalls, ['/api/raffle/create'])
      assert.notEqual(rendered.queryByText(/Managed raffle session-raffle-2/i), null)
    })
    assert.equal(rendered.queryByText(/This launch link needs attention/i), null)
  } finally {
    cleanup()
  }
})

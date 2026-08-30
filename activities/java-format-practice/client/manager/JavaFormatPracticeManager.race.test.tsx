import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'

;(globalThis as { React?: typeof React }).React = React

type SocketHandler = ((...args: unknown[]) => void) | null
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

  emitOpen(): void {
    this.onopen?.(new Event('open'))
  }

  emitStudents(students: unknown[]): void {
    this.onmessage?.({ data: JSON.stringify({ type: 'studentsUpdate', payload: { students } }) })
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

async function loadHarness() {
  const testingLibrary = await import('@testing-library/react')
  const router = await import('react-router')
  const { default: JavaFormatPracticeManager } = await import('./JavaFormatPracticeManager.js')
  return { testingLibrary, router, JavaFormatPracticeManager, act: testingLibrary.act as TestingLibraryAct }
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
    if (url.includes('/persistent-manager-capability')) return new Response('{}', { status: 200 })
    if (url.includes('/students')) {
      studentsCalls += 1
      // The mount poll is deliberately slow so a socket update can land before it
      // resolves; any later poll echoes the roster the socket will also deliver.
      if (studentsCalls === 1) return initialRoster
      return new Response(JSON.stringify({ students: [studentRecord('a', 'Ada')] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()
    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/session-1']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    await testingLibrary.waitFor(() => { assert.ok(TestWebSocket.instances.length >= 1) })
    await act(async () => { TestWebSocket.instances[0]?.emitOpen(); await Promise.resolve() })

    // A live studentsUpdate arrives while the mount poll is still in flight.
    await act(async () => { TestWebSocket.instances[0]?.emitStudents([studentRecord('a', 'Ada')]); await Promise.resolve() })
    await testingLibrary.waitFor(() => { assert.ok(rendered.queryByText('Ada')) })

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
    if (url.includes('/persistent-manager-capability')) return new Response('{}', { status: 200 })
    if (url.includes('/students')) {
      return new Response(JSON.stringify({ students: [studentRecord('c', 'Cass')] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()
    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/session-2']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    await testingLibrary.waitFor(() => { assert.ok(rendered.queryByText('Cass')) })
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager ignores a studentsUpdate queued on a previous session socket', { concurrency: false }, async () => {
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/session-1')
  const previousFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/persistent-manager-capability')) return new Response('{}', { status: 200 })
    if (url.includes('/api/java-format-practice/session-1/students')) {
      return new Response(JSON.stringify({ students: [studentRecord('a', 'Ada')] }), { status: 200 })
    }
    if (url.includes('/api/java-format-practice/session-2/students')) {
      return new Response(JSON.stringify({ students: [studentRecord('c', 'Cass')] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()

    function NavProbe(): React.JSX.Element {
      const navigate = router.useNavigate()
      return (
        <>
          <JavaFormatPracticeManager />
          <button type="button" onClick={() => navigate('/manage/java-format-practice/session-2')}>go</button>
        </>
      )
    }

    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/session-1']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<NavProbe />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    await testingLibrary.waitFor(() => { assert.ok(TestWebSocket.instances.length >= 1) })
    const firstSocket = TestWebSocket.instances[0]!
    await act(async () => { firstSocket.emitOpen(); await Promise.resolve() })
    await testingLibrary.waitFor(() => { assert.ok(rendered.queryByText('Ada')) })

    // Route to a different session; the manager effect tears down the first socket.
    await act(async () => { testingLibrary.fireEvent.click(rendered.getByRole('button', { name: 'go' })); await Promise.resolve() })
    // The previous session's roster must not linger on the new URL.
    assert.equal(rendered.queryByText('Ada'), null, 'the prior session roster is cleared on the session swap')
    await testingLibrary.waitFor(() => { assert.ok(TestWebSocket.instances.length >= 2) })
    const secondSocket = TestWebSocket.instances[1]!
    await act(async () => { secondSocket.emitOpen(); await Promise.resolve() })
    await testingLibrary.waitFor(() => { assert.ok(rendered.queryByText('Cass')) })

    // A message that was queued on the old session's socket must not replace the
    // new session's roster.
    await act(async () => { firstSocket.emitStudents([studentRecord('z', 'Zed')]); await Promise.resolve() })

    assert.ok(rendered.queryByText('Cass'), 'the current session roster is retained')
    assert.equal(rendered.queryByText('Zed'), null, 'the stale socket message is ignored')
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager serializes /students polls and still renders a slow response', { concurrency: false }, async () => {
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/session-9')
  const previousFetch = globalThis.fetch

  let resolveRoster: ((response: Response) => void) | null = null
  const roster = new Promise<Response>((resolve) => { resolveRoster = resolve })
  let studentsCalls = 0

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/persistent-manager-capability')) return new Response('{}', { status: 200 })
    if (String(input).includes('/students')) {
      studentsCalls += 1
      return roster
    }
    throw new Error(`Unexpected fetch: ${String(input)}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()
    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/session-9']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    await testingLibrary.waitFor(() => { assert.ok(TestWebSocket.instances.length >= 1) })
    // The mount poll is still in flight; the on-open poll must not stack on it.
    await act(async () => { TestWebSocket.instances[0]?.emitOpen(); await Promise.resolve(); await Promise.resolve() })
    assert.equal(studentsCalls, 1, 'a second poll is not started while one is in flight')

    // The slow response still gets to render once it resolves.
    await act(async () => {
      resolveRoster?.(new Response(JSON.stringify({ students: [studentRecord('s', 'Sol')] }), { status: 200 }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await testingLibrary.waitFor(() => { assert.ok(rendered.queryByText('Sol')) })
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager auth-lost banner starts a fresh session instead of reloading', { concurrency: false }, async () => {
  console.info('[TEST] java-format manager: a 403 persistent-capability response and a 403 roster response are expected below; the exchange gives up and the roster 403 latches the auth-lost banner')
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/dead-session')
  const previousFetch = globalThis.fetch
  let createCalls = 0

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    // No persistent teacher cookie for this dead session: the capability exchange
    // 403s, the gate releases, and the roster poll's own 403 latches the banner.
    if (url.includes('/persistent-manager-capability')) {
      return new Response(JSON.stringify({ error: 'Persistent teacher authentication is required' }), { status: 403 })
    }
    if (url.includes('/api/java-format-practice/create') && init?.method === 'POST') {
      createCalls += 1
      return new Response(JSON.stringify({ id: 'fresh-session' }), { status: 200 })
    }
    if (url.includes('/api/java-format-practice/dead-session/students')) {
      return new Response(JSON.stringify({ error: 'manager authentication required' }), { status: 403 })
    }
    if (url.includes('/api/java-format-practice/fresh-session/students')) {
      return new Response(JSON.stringify({ students: [] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()

    function LocationProbe(): React.JSX.Element {
      return <span data-testid="loc">{router.useLocation().pathname}</span>
    }

    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/dead-session']}>
        <LocationProbe />
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    // The 403 roster poll latches auth-loss and surfaces the recovery banner.
    const startButton = await testingLibrary.waitFor(() => rendered.getByRole('button', { name: 'Start new session' }))
    assert.equal(rendered.queryByRole('button', { name: /reload/i }), null, 'no misleading Reload affordance')

    await act(async () => { testingLibrary.fireEvent.click(startButton); await Promise.resolve(); await Promise.resolve() })

    assert.equal(createCalls, 1, 'a fresh session was minted via POST /create')
    await testingLibrary.waitFor(() => {
      assert.equal(rendered.getByTestId('loc').textContent, '/manage/java-format-practice/fresh-session')
    })
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager auth-lost banner offers a reload path for a persistently recoverable manager', { concurrency: false }, async () => {
  console.info('[TEST] java-format manager: a 403 roster response is expected below to latch the auth-lost banner after a full persistent capability success')
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/perma-session')
  const previousFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    // Full persistent success: a valid teacher cookie was redeemed (no
    // `alreadyAuthorized`), so a later capability expiry is recoverable by reload.
    if (url.includes('/persistent-manager-capability')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    // The capability then lapses and the roster poll 403s, latching auth-loss.
    if (url.includes('/api/java-format-practice/perma-session/students')) {
      return new Response(JSON.stringify({ error: 'manager authentication required' }), { status: 403 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()
    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/perma-session']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    // getByRole throws if the reload affordance is absent, so this resolving is the assertion.
    await testingLibrary.waitFor(() => rendered.getByRole('button', { name: /reload/i }))
    assert.ok(rendered.queryByText(/reload the page to restore it/i), 'banner text points at reload recovery')
    assert.equal(rendered.queryByText(/reloading won.t restore it/i), null, 'the temporary-session message is not shown')
    assert.ok(rendered.queryByRole('button', { name: 'Start new session' }), 'start-new-session remains available as a fallback')
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager gates difficulty/theme controls until the persistent capability exchange settles', { concurrency: false }, async () => {
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/perma-session')
  const previousFetch = globalThis.fetch

  let resolveCapability: ((response: Response) => void) | null = null
  const capability = new Promise<Response>((resolve) => { resolveCapability = resolve })
  let difficultyCalls = 0

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/persistent-manager-capability')) {
      return capability
    }
    if (url.includes('/difficulty') && init?.method === 'POST') {
      difficultyCalls += 1
      return new Response('{}', { status: 200 })
    }
    if (url.includes('/students')) {
      return new Response(JSON.stringify({ students: [] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()
    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/perma-session']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    // While the capability POST is still pending, the manager controls are inert:
    // a request sent now would 403 and permanently latch manager-auth-lost.
    const beginner = await testingLibrary.waitFor(() => rendered.getByRole('button', { name: 'Beginner' }))
    assert.equal((beginner as HTMLButtonElement).disabled, true, 'difficulty control is disabled before the exchange settles')
    await act(async () => { testingLibrary.fireEvent.click(beginner); await Promise.resolve() })
    assert.equal(difficultyCalls, 0, 'no capability-gated request is sent before the cookie lands')

    // Once the exchange resolves, the controls become usable.
    await act(async () => {
      resolveCapability?.(new Response('{}', { status: 200 }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await testingLibrary.waitFor(() => {
      assert.equal((rendered.getByRole('button', { name: 'Beginner' }) as HTMLButtonElement).disabled, false)
    })
    await act(async () => { testingLibrary.fireEvent.click(rendered.getByRole('button', { name: 'Beginner' })); await Promise.resolve() })
    assert.equal(difficultyCalls, 1, 'the difficulty request is sent once the capability is ready')
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager re-gates controls for the new session after a parameter-only route swap', { concurrency: false }, async () => {
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/session-A')
  const previousFetch = globalThis.fetch

  const difficultyCallsBySession = new Map<string, number>()
  let sessionBCapabilityResolved: (() => void) | null = null
  const sessionBCapability = new Promise<Response>((resolve) => {
    sessionBCapabilityResolved = () => resolve(new Response('{}', { status: 200 }))
  })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/session-A/persistent-manager-capability')) {
      return new Response('{}', { status: 200 })
    }
    if (url.includes('/session-B/persistent-manager-capability')) {
      return sessionBCapability
    }
    const difficultyMatch = url.match(/\/api\/java-format-practice\/(session-[AB])\/difficulty/)
    if (difficultyMatch && init?.method === 'POST') {
      difficultyCallsBySession.set(difficultyMatch[1]!, (difficultyCallsBySession.get(difficultyMatch[1]!) ?? 0) + 1)
      return new Response('{}', { status: 200 })
    }
    if (url.includes('/students')) {
      return new Response(JSON.stringify({ students: [] }), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()

    function NavProbe(): React.JSX.Element {
      const navigate = router.useNavigate()
      return (
        <>
          <JavaFormatPracticeManager />
          <button type="button" onClick={() => navigate('/manage/java-format-practice/session-B')}>go</button>
        </>
      )
    }

    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/session-A']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<NavProbe />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    // Session A's exchange resolves, so its controls are live.
    await testingLibrary.waitFor(() => {
      assert.equal((rendered.getByRole('button', { name: 'Beginner' }) as HTMLButtonElement).disabled, false)
    })

    // Parameter-only swap to session B, whose exchange is still pending.
    await act(async () => { testingLibrary.fireEvent.click(rendered.getByRole('button', { name: 'go' })); await Promise.resolve() })

    // Readiness is scoped to the session id, so B's controls are inert immediately -
    // no window where A's completed exchange makes B's buttons clickable.
    const beginner = rendered.getByRole('button', { name: 'Beginner' })
    assert.equal((beginner as HTMLButtonElement).disabled, true, 'the new session re-gates its controls')
    await act(async () => { testingLibrary.fireEvent.click(beginner); await Promise.resolve() })
    assert.equal(difficultyCallsBySession.get('session-B') ?? 0, 0, 'no session-B request is sent while its exchange is pending')

    // Once B's exchange settles, its controls become usable.
    await act(async () => { sessionBCapabilityResolved?.(); await Promise.resolve(); await Promise.resolve() })
    await testingLibrary.waitFor(() => {
      assert.equal((rendered.getByRole('button', { name: 'Beginner' }) as HTMLButtonElement).disabled, false)
    })
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

void test('JavaFormatPracticeManager keeps controls gated when the persistent capability exchange keeps failing', { concurrency: false }, async () => {
  console.info('[TEST] java-format manager: the persistent-capability exchange 500s below; the failed attempt is expected noise and must not release the control gate')
  TestWebSocket.instances = []
  const restoreDom = installDomEnvironment('https://bits.example/manage/java-format-practice/perma-500')
  const previousFetch = globalThis.fetch

  let studentsCalls = 0

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/persistent-manager-capability')) {
      return new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 })
    }
    if (url.includes('/students')) {
      studentsCalls += 1
      return new Response(JSON.stringify({ students: [] }), { status: 200 })
    }
    if (url.includes('/difficulty') && init?.method === 'POST') {
      throw new Error('difficulty must not be requested without a manager capability')
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let teardown: (() => Promise<void>) | null = null
  try {
    const { testingLibrary, router, JavaFormatPracticeManager, act } = await loadHarness()
    const rendered = testingLibrary.render(
      <router.MemoryRouter initialEntries={['/manage/java-format-practice/perma-500']}>
        <router.Routes>
          <router.Route path="/manage/java-format-practice/:sessionId" element={<JavaFormatPracticeManager />} />
        </router.Routes>
      </router.MemoryRouter>,
    )
    teardown = async () => { await act(async () => { rendered.unmount(); testingLibrary.cleanup(); await Promise.resolve() }) }

    // Let the first (failing) exchange attempt settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    // A transient 500 must not open the protected surfaces: no cookie was issued.
    assert.equal((rendered.getByRole('button', { name: 'Beginner' }) as HTMLButtonElement).disabled, true)
    assert.equal(studentsCalls, 0, 'the roster poll never runs while the capability exchange is failing')
  } finally {
    await teardown?.()
    globalThis.fetch = previousFetch
    restoreDom()
  }
})

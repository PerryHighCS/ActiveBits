import test from 'node:test'
import assert from 'node:assert/strict'
import type { ComponentType } from 'react'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { MemoryRouter } from 'react-router-dom'
import type { ActivityPersistentLinkBuilderProps, ActivityRegistryEntry } from '../../../../types/activity.js'
import {
  isPersistentLinkPreflightVerified,
  resolvePersistentLinkPreflightValue,
} from './manageDashboardUtils'
import { resolveCustomPersistentLinkBuilder } from './manageDashboardViewUtils'

;(globalThis as { React?: typeof React }).React = React

function DummyBuilder(): null {
  return null
}

function TestPersistentLinkBuilder({
  selectedOptions,
  onSelectedOptionsChange,
  onSubmitReadinessChange,
}: ActivityPersistentLinkBuilderProps): React.JSX.Element {
  const [presentationUrl, setPresentationUrl] = React.useState(selectedOptions?.presentationUrl ?? '')

  return (
    <div>
      <label htmlFor="test-presentation-url">Presentation URL</label>
      <input
        id="test-presentation-url"
        type="text"
        value={presentationUrl}
        onChange={(event) => {
          const nextValue = event.target.value
          setPresentationUrl(nextValue)
          onSelectedOptionsChange?.({ presentationUrl: nextValue })
          onSubmitReadinessChange?.(false)
        }}
      />
      <button
        type="button"
        onClick={() => {
          onSubmitReadinessChange?.(presentationUrl.trim().length > 0)
        }}
      >
        Prepare Link Options
      </button>
    </div>
  )
}

const testActivity: ActivityRegistryEntry = {
  id: 'test-activity',
  name: 'Test Activity',
  title: 'Test Activity',
  description: 'A test activity for permalink gating coverage.',
  color: 'blue',
  standaloneEntry: { enabled: true, supportsPermalink: true },
  deepLinkOptions: {
    presentationUrl: {
      label: 'Presentation URL',
      type: 'text',
      validator: 'url',
    },
  },
  deepLinkGenerator: {
    endpoint: '/api/persistent-session/create',
    preflight: {
      type: 'reveal-sync-ping',
      optionKey: 'presentationUrl',
    },
  },
  manageDashboard: {
    customPersistentLinkBuilder: false,
  },
  PersistentLinkBuilderComponent: TestPersistentLinkBuilder as ComponentType<unknown>,
}

const testActivityRegistryHooks = {
  activityRegistry: [testActivity],
  runDeepLinkPreflight: async (
    activityId: string,
    preflight: { optionKey: string },
    rawValue: string,
  ) => {
    assert.equal(activityId, 'test-activity')
    assert.equal(preflight.optionKey, 'presentationUrl')
    return {
      valid: rawValue === 'https://slides.example/deck-one',
      warning: rawValue === 'https://slides.example/deck-one' ? null : 'Unexpected deck URL',
    }
  },
}

type DashboardActivityLike = Parameters<typeof resolveCustomPersistentLinkBuilder>[0]

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/manage',
  })

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

interface RenderedScreenLike {
  getByRole: (role: string, options?: { name?: string | RegExp }) => HTMLElement
  getByLabelText: (text: string | RegExp) => HTMLElement
  queryByText: (text: string | RegExp) => HTMLElement | null
}

interface ManageDashboardTestProps {
  activityRegistry: ActivityRegistryEntry[]
  runDeepLinkPreflight: typeof testActivityRegistryHooks.runDeepLinkPreflight
}

async function openPermanentLinkModal(rendered: RenderedScreenLike) {
  rendered.getByRole('button', { name: 'Create Permanent Link' }).click()
}

function installFetchStub() {
  const previousFetch = globalThis.fetch
  const calls: string[] = []

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)

    if (url === '/api/persistent-session/list') {
      return {
        ok: true,
        json: async () => ({ sessions: [] }),
      } as Response
    }

    if (url === '/api/persistent-session/create' || url === '/api/persistent-session/update') {
      return {
        ok: true,
        json: async () => ({
          url: '/activity/syncdeck/hash-123',
          hash: 'hash-123',
        }),
      } as Response
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  return {
    calls,
    restore: () => {
      ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    },
  }
}

void test('resolveCustomPersistentLinkBuilder returns null when no custom builder flag is enabled', () => {
  const activity = {
    manageDashboard: { customPersistentLinkBuilder: false },
    PersistentLinkBuilderComponent: DummyBuilder as ComponentType<unknown>,
  } satisfies NonNullable<DashboardActivityLike>

  assert.equal(resolveCustomPersistentLinkBuilder(activity), null)
})

void test('resolveCustomPersistentLinkBuilder returns null when flag is enabled but component is missing', () => {
  const activity = {
    manageDashboard: { customPersistentLinkBuilder: true },
    PersistentLinkBuilderComponent: null,
  } satisfies NonNullable<DashboardActivityLike>

  assert.equal(resolveCustomPersistentLinkBuilder(activity), null)
})

void test('resolveCustomPersistentLinkBuilder returns activity-owned builder when flag and component are present', () => {
  const activity = {
    manageDashboard: { customPersistentLinkBuilder: true },
    PersistentLinkBuilderComponent: DummyBuilder as ComponentType<unknown>,
  } satisfies NonNullable<DashboardActivityLike>

  assert.equal(resolveCustomPersistentLinkBuilder(activity), DummyBuilder)
})

void test('resolvePersistentLinkPreflightValue trims the configured option value only', () => {
  assert.equal(
    resolvePersistentLinkPreflightValue('presentationUrl', {
      presentationUrl: '  https://slides.example/deck  ',
      ignored: ' value ',
    }),
    'https://slides.example/deck',
  )
  assert.equal(resolvePersistentLinkPreflightValue('missing', { presentationUrl: 'https://slides.example/deck' }), '')
  assert.equal(resolvePersistentLinkPreflightValue(null, { presentationUrl: 'https://slides.example/deck' }), '')
})

void test('isPersistentLinkPreflightVerified matches the submit-time preflight rule', () => {
  assert.equal(
    isPersistentLinkPreflightVerified(
      'presentationUrl',
      { presentationUrl: 'https://slides.example/deck' },
      'https://slides.example/deck',
    ),
    true,
  )
  assert.equal(
    isPersistentLinkPreflightVerified(
      'presentationUrl',
      { presentationUrl: 'https://slides.example/updated' },
      'https://slides.example/deck',
    ),
    false,
  )
  assert.equal(
    isPersistentLinkPreflightVerified(
      'presentationUrl',
      { presentationUrl: '' },
      null,
    ),
    true,
  )
  assert.equal(
    isPersistentLinkPreflightVerified(
      null,
      { presentationUrl: 'https://slides.example/deck' },
      null,
    ),
    true,
  )
})

void test('ManageDashboard generic preflight option requires verify before submit and invalidates on change', { concurrency: false }, async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const fetchStub = installFetchStub()
  const originalCustomBuilder = testActivity.manageDashboard?.customPersistentLinkBuilder
  testActivity.manageDashboard = {
    ...testActivity.manageDashboard,
    customPersistentLinkBuilder: false,
  }

  try {
    const { fireEvent, render, waitFor } = await import('@testing-library/react')
    const { default: ManageDashboard } = await import('./ManageDashboard.js')
    const TypedManageDashboard = ManageDashboard as ComponentType<ManageDashboardTestProps>
    const rendered = render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(TypedManageDashboard, {
          activityRegistry: testActivityRegistryHooks.activityRegistry,
          runDeepLinkPreflight: testActivityRegistryHooks.runDeepLinkPreflight,
        }),
      ),
    )

    await openPermanentLinkModal(rendered)

    const teacherCodeInput = await waitFor(() => rendered.getByLabelText(/teacher code/i))
    const presentationUrlInput = rendered.getByLabelText(/presentation url/i)
    const submitButton = rendered.getByRole('button', { name: /generate link/i }) as HTMLButtonElement

    fireEvent.change(teacherCodeInput, { target: { value: 'teacher-code' } })
    fireEvent.input(presentationUrlInput, { target: { value: 'https://slides.example/deck-one' } })

    await waitFor(() => {
      assert.equal(submitButton.disabled, true)
      assert.notEqual(rendered.queryByText('Verify this value before creating the link.'), null)
    })

    fireEvent.click(submitButton)
    assert.deepEqual(fetchStub.calls, ['/api/persistent-session/list'])

    fireEvent.click(rendered.getByRole('button', { name: /verify url/i }))

    await waitFor(() => {
      assert.equal(submitButton.disabled, false)
      assert.notEqual(rendered.queryByText('Value verified. You can now create the link.'), null)
    })

    fireEvent.input(presentationUrlInput, { target: { value: 'https://slides.example/deck-two' } })

    await waitFor(() => {
      assert.equal(submitButton.disabled, true)
      assert.notEqual(rendered.queryByText('Verify this value before creating the link.'), null)
    })
  } finally {
    testActivity.manageDashboard = {
      ...testActivity.manageDashboard,
      ...(originalCustomBuilder !== undefined ? { customPersistentLinkBuilder: originalCustomBuilder } : {}),
    }
    fetchStub.restore()
    restoreDomEnvironment()
  }
})

void test('ManageDashboard custom builders must signal readiness before submit proceeds', { concurrency: false }, async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const fetchStub = installFetchStub()
  const originalCustomBuilder = testActivity.manageDashboard?.customPersistentLinkBuilder
  testActivity.manageDashboard = {
    ...testActivity.manageDashboard,
    customPersistentLinkBuilder: true,
  }

  try {
    const { fireEvent, render, waitFor } = await import('@testing-library/react')
    const { default: ManageDashboard } = await import('./ManageDashboard.js')
    const TypedManageDashboard = ManageDashboard as ComponentType<ManageDashboardTestProps>
    const rendered = render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(TypedManageDashboard, {
          activityRegistry: testActivityRegistryHooks.activityRegistry,
          runDeepLinkPreflight: testActivityRegistryHooks.runDeepLinkPreflight,
        }),
      ),
    )

    await openPermanentLinkModal(rendered)

    const teacherCodeInput = await waitFor(() => rendered.getByLabelText(/teacher code/i))
    const presentationUrlInput = rendered.getByLabelText(/presentation url/i)
    const submitButton = rendered.getByRole('button', { name: /generate link/i }) as HTMLButtonElement

    fireEvent.change(teacherCodeInput, { target: { value: 'teacher-code' } })
    fireEvent.input(presentationUrlInput, { target: { value: 'https://slides.example/deck-one' } })

    await waitFor(() => {
      assert.equal(submitButton.disabled, true)
    })

    fireEvent.click(submitButton)

    await waitFor(() => {
      assert.deepEqual(fetchStub.calls, ['/api/persistent-session/list'])
    })

    fireEvent.click(rendered.getByRole('button', { name: /prepare link options/i }))

    await waitFor(() => {
      assert.equal(submitButton.disabled, false)
    })

    fireEvent.click(submitButton)

    await waitFor(() => {
      assert.deepEqual(fetchStub.calls, [
        '/api/persistent-session/list',
        '/api/persistent-session/create',
        '/api/persistent-session/list',
      ])
    })
  } finally {
    testActivity.manageDashboard = {
      ...testActivity.manageDashboard,
      ...(originalCustomBuilder !== undefined ? { customPersistentLinkBuilder: originalCustomBuilder } : {}),
    }
    fetchStub.restore()
    restoreDomEnvironment()
  }
})

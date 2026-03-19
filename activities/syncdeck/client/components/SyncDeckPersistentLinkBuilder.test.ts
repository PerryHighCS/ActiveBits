import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import type { SyncDeckPreflightResult } from '../shared/presentationPreflight.js'
import { resolveSyncDeckPersistentLinkBuilderRequest } from './SyncDeckPersistentLinkBuilder.js'

;(globalThis as { React?: typeof React }).React = React

void test('resolveSyncDeckPersistentLinkBuilderRequest uses shared persistent-session create for new links', () => {
  assert.deepEqual(
    resolveSyncDeckPersistentLinkBuilderRequest({
      activityId: 'syncdeck',
      normalizedTeacherCode: 'teacher-code',
      normalizedPresentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
      editState: null,
    }),
    {
      endpoint: '/api/persistent-session/create',
      body: {
        activityName: 'syncdeck',
        teacherCode: 'teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
        },
      },
    },
  )
})

void test('resolveSyncDeckPersistentLinkBuilderRequest uses persistent-session update for edits', () => {
  assert.deepEqual(
    resolveSyncDeckPersistentLinkBuilderRequest({
      activityId: 'syncdeck',
      normalizedTeacherCode: 'teacher-code',
      normalizedPresentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
      editState: {
        hash: 'hash-123',
        teacherCode: 'teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:5173/presentations/syncdeck-conversion-lab.html',
        },
      },
    }),
    {
      endpoint: '/api/persistent-session/update',
      body: {
        activityName: 'syncdeck',
        hash: 'hash-123',
        teacherCode: 'teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
        },
      },
    },
  )
})

void test('resolveSyncDeckPersistentLinkBuilderRequest creates a new link when edit teacher code changes', () => {
  assert.deepEqual(
    resolveSyncDeckPersistentLinkBuilderRequest({
      activityId: 'syncdeck',
      normalizedTeacherCode: 'new-teacher-code',
      normalizedPresentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
      editState: {
        hash: 'hash-123',
        teacherCode: 'teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:5173/presentations/syncdeck-conversion-lab.html',
        },
      },
    }),
    {
      endpoint: '/api/persistent-session/create',
      body: {
        activityName: 'syncdeck',
        teacherCode: 'new-teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
        },
      },
    },
  )
})

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
  })

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
    const documentBody = globalThis.document?.body
    if (documentBody != null) {
      documentBody.innerHTML = ''
    }
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

void test('SyncDeckPersistentLinkBuilder submit stays disabled until verify succeeds and re-disables after URL changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')
  const { default: SyncDeckPersistentLinkBuilder } = await import('./SyncDeckPersistentLinkBuilder.js')
  const preflightCalls: string[] = []
  const preflightRunner = async (url: string): Promise<SyncDeckPreflightResult> => {
    preflightCalls.push(url)
    return { valid: true, warning: null }
  }

  try {
    const rendered = render(
      React.createElement(SyncDeckPersistentLinkBuilder, {
        activityId: 'syncdeck',
        editState: null,
        preflightRunner,
        onCreated: async () => undefined,
      }),
    )

    const teacherCodeInput = rendered.getByPlaceholderText(/create a teacher code for this link/i)
    const presentationUrlInput = rendered.getByPlaceholderText('https://...')
    const submitButton = rendered.getByRole('button', { name: /generate link/i })

    fireEvent.input(teacherCodeInput, { target: { value: 'teacher-code' } })
    fireEvent.input(presentationUrlInput, { target: { value: 'https://slides.example/deck' } })

    await waitFor(() => {
      assert.equal((teacherCodeInput as HTMLInputElement).value, 'teacher-code')
      assert.equal((presentationUrlInput as HTMLInputElement).value, 'https://slides.example/deck')
    })

    await waitFor(() => {
      assert.notEqual(rendered.queryByText('Verify this URL before creating the link.'), null)
    })

    assert.equal((submitButton as HTMLButtonElement).disabled, true)

    await waitFor(() => {
      assert.equal((rendered.getByRole('button', { name: /verify url/i }) as HTMLButtonElement).disabled, false)
    })

    fireEvent.click(rendered.getByRole('button', { name: /verify url/i }))

    await waitFor(() => {
      assert.deepEqual(preflightCalls, ['https://slides.example/deck'])
      assert.equal((submitButton as HTMLButtonElement).disabled, false)
    })

    fireEvent.input(presentationUrlInput, { target: { value: 'https://slides.example/updated-deck' } })

    await waitFor(() => {
      assert.equal((submitButton as HTMLButtonElement).disabled, true)
    })
  } finally {
    restoreDomEnvironment()
  }
})

void test('SyncDeckPersistentLinkBuilder syncs local form state when edit hash changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')
  const { default: SyncDeckPersistentLinkBuilder } = await import('./SyncDeckPersistentLinkBuilder.js')

  try {
    const rendered = render(
      React.createElement(SyncDeckPersistentLinkBuilder, {
        activityId: 'syncdeck',
        editState: {
          hash: 'hash-1',
          teacherCode: 'teacher-one',
          entryPolicy: 'instructor-required',
          selectedOptions: {
            presentationUrl: 'https://slides.example/deck-one',
          },
        },
        preflightRunner: async (): Promise<SyncDeckPreflightResult> => ({ valid: true, warning: null }),
        onCreated: async () => undefined,
      }),
    )

    const teacherCodeInput = rendered.getByLabelText(/teacher code/i)
    const presentationUrlInput = rendered.getByLabelText(/presentation url/i)
    const submitButton = rendered.getByRole('button', { name: /save changes/i })

    await waitFor(() => {
      assert.equal((teacherCodeInput as HTMLInputElement).value, 'teacher-one')
      assert.equal((presentationUrlInput as HTMLInputElement).value, 'https://slides.example/deck-one')
    })

    fireEvent.click(rendered.getByRole('button', { name: /verify url/i }))

    await waitFor(() => {
      assert.equal((submitButton as HTMLButtonElement).disabled, false)
    })

    rendered.rerender(
      React.createElement(SyncDeckPersistentLinkBuilder, {
        activityId: 'syncdeck',
        editState: {
          hash: 'hash-2',
          teacherCode: 'teacher-two',
          entryPolicy: 'instructor-required',
          selectedOptions: {
            presentationUrl: 'https://slides.example/deck-two',
          },
        },
        preflightRunner: async (): Promise<SyncDeckPreflightResult> => ({ valid: true, warning: null }),
        onCreated: async () => undefined,
      }),
    )

    await waitFor(() => {
      assert.equal((teacherCodeInput as HTMLInputElement).value, 'teacher-two')
      assert.equal((presentationUrlInput as HTMLInputElement).value, 'https://slides.example/deck-two')
      assert.equal((submitButton as HTMLButtonElement).disabled, true)
      assert.notEqual(rendered.queryByText('Verify this URL before creating the link.'), null)
    })
  } finally {
    restoreDomEnvironment()
  }
})

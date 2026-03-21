import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import type { SyncDeckPreflightResult } from '../shared/presentationPreflight.js'

;(globalThis as { React?: typeof React }).React = React

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

void test('SyncDeckPersistentLinkBuilder reports selected options and readiness only after verify succeeds', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')
  const { default: SyncDeckPersistentLinkBuilder } = await import('./SyncDeckPersistentLinkBuilder.js')
  const preflightCalls: string[] = []
  const selectedOptionsSnapshots: Array<Record<string, string>> = []
  const readinessChanges: boolean[] = []
  const preflightRunner = async (url: string): Promise<SyncDeckPreflightResult> => {
    preflightCalls.push(url)
    return { valid: true, warning: null }
  }

  try {
    const rendered = render(
      React.createElement(SyncDeckPersistentLinkBuilder, {
        activityId: 'syncdeck',
        selectedOptions: {},
        editState: null,
        preflightRunner,
        onSelectedOptionsChange: (selectedOptions) => {
          selectedOptionsSnapshots.push(selectedOptions)
        },
        onSubmitReadinessChange: (canSubmit) => {
          readinessChanges.push(canSubmit)
        },
        onCreated: async () => undefined,
      }),
    )

    const presentationUrlInput = rendered.getByPlaceholderText('https://...')
    fireEvent.input(presentationUrlInput, { target: { value: 'https://slides.example/deck' } })

    await waitFor(() => {
      assert.equal((presentationUrlInput as HTMLInputElement).value, 'https://slides.example/deck')
      assert.deepEqual(selectedOptionsSnapshots.at(-1), { presentationUrl: 'https://slides.example/deck' })
      assert.equal(readinessChanges.at(-1), false)
    })

    fireEvent.click(rendered.getByRole('button', { name: /verify url/i }))

    await waitFor(() => {
      assert.deepEqual(preflightCalls, ['https://slides.example/deck'])
      assert.equal(readinessChanges.at(-1), true)
      assert.notEqual(rendered.queryByTitle('SyncDeck link preflight preview'), null)
    })
  } finally {
    restoreDomEnvironment()
  }
})

void test('SyncDeckPersistentLinkBuilder resets readiness and preview when the URL changes after verify', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')
  const { default: SyncDeckPersistentLinkBuilder } = await import('./SyncDeckPersistentLinkBuilder.js')

  try {
    const readinessChanges: boolean[] = []
    const rendered = render(
      React.createElement(SyncDeckPersistentLinkBuilder, {
        activityId: 'syncdeck',
        selectedOptions: {
          presentationUrl: 'https://slides.example/deck-one',
        },
        editState: null,
        preflightRunner: async (): Promise<SyncDeckPreflightResult> => ({ valid: true, warning: null }),
        onSelectedOptionsChange: () => undefined,
        onSubmitReadinessChange: (canSubmit) => {
          readinessChanges.push(canSubmit)
        },
        onCreated: async () => undefined,
      }),
    )

    const presentationUrlInput = rendered.getByLabelText(/presentation url/i)
    fireEvent.click(rendered.getByRole('button', { name: /verify url/i }))

    await waitFor(() => {
      assert.equal(readinessChanges.at(-1), true)
      assert.notEqual(rendered.queryByTitle('SyncDeck link preflight preview'), null)
    })

    fireEvent.input(presentationUrlInput, { target: { value: 'https://slides.example/deck-two' } })

    await waitFor(() => {
      assert.equal(readinessChanges.at(-1), false)
      assert.equal(rendered.queryByTitle('SyncDeck link preflight preview'), null)
    })
  } finally {
    restoreDomEnvironment()
  }
})


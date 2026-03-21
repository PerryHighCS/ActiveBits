import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { normalizeEditStateQuestions } from './ResonancePersistentLinkBuilder.js'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
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

void test('normalizeEditStateQuestions returns normalized non-empty questions for valid input', () => {
  const result = normalizeEditStateQuestions([
    {
      id: 'q1',
      type: 'free-response',
      text: '  Hello world  ',
      order: 0,
      extraField: 'should-be-stripped',
    },
  ])

  assert.ok(result !== null)
  assert.equal(result.length, 1)
  assert.equal(result[0]?.text, 'Hello world')
  assert.ok(!Object.prototype.hasOwnProperty.call(result[0] as object, 'extraField'))
})

void test('normalizeEditStateQuestions returns null for invalid question shapes', () => {
  const result = normalizeEditStateQuestions([
    {
      id: 'q1',
      type: 'essay',
      text: 'Invalid type',
      order: 0,
    },
  ])

  assert.equal(result, null)
})

void test('normalizeEditStateQuestions returns null for empty arrays', () => {
  assert.equal(normalizeEditStateQuestions([]), null)
})

void test('ResonancePersistentLinkBuilder prepares selectedOptions and submit readiness for shared submit', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { act, render, waitFor } = await import('@testing-library/react')
  const { default: ResonancePersistentLinkBuilder } = await import('./ResonancePersistentLinkBuilder.js')
  let rendered: ReturnType<typeof render> | null = null
  const selectedOptionsSnapshots: Array<Record<string, string>> = []
  const readinessChanges: boolean[] = []

  try {
    ;(globalThis as { fetch?: typeof fetch }).fetch = (async () => ({
      ok: true,
      json: async () => ({
        selectedOptions: {
          q: 'encoded-questions',
          h: 'prep-hash-123',
        },
      }),
    })) as unknown as typeof fetch

    rendered = render(
      React.createElement(ResonancePersistentLinkBuilder, {
        activityId: 'resonance',
        teacherCode: 'teacher-code',
        selectedOptions: {},
        editState: {
          hash: 'hash-123',
          teacherCode: 'teacher-code',
          selectedOptions: {
            questions: [
              {
                id: 'q1',
                type: 'free-response',
                text: 'What stands out?',
                order: 0,
              },
            ],
          },
        },
        onSelectedOptionsChange: (nextSelectedOptions) => {
          selectedOptionsSnapshots.push(nextSelectedOptions)
        },
        onSubmitReadinessChange: (canSubmit) => {
          readinessChanges.push(canSubmit)
        },
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => {
      assert.deepEqual(selectedOptionsSnapshots.at(-1), {
        q: 'encoded-questions',
        h: 'prep-hash-123',
      })
      assert.equal(readinessChanges.at(-1), true)
    })
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    rendered?.unmount()
    restoreDomEnvironment()
  }
})

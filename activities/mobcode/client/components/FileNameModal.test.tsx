import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { JSDOM } from 'jsdom'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment(url: string) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousHTMLElement = globalThis.HTMLElement
  const previousNode = globalThis.Node
  const previousEvent = globalThis.Event

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  })
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Node = dom.window.Node
  globalThis.Event = dom.window.Event as typeof Event

  return () => {
    globalThis.document?.body?.replaceChildren()
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    globalThis.HTMLElement = previousHTMLElement
    globalThis.Node = previousNode
    globalThis.Event = previousEvent
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

void test('FileNameModal accepts paths that normalize to a safe relative path', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const { default: FileNameModal } = await import('./FileNameModal')

  try {
    let submittedPath = ''
    const rendered = render(
      <FileNameModal
        open
        title="Create file"
        submitLabel="Create"
        onClose={() => {}}
        onSubmit={(path) => {
          submittedPath = path
        }}
      />,
    )

    fireEvent.change(rendered.getByLabelText('Path'), {
      target: { value: ' /src\\Main.java ' },
    })
    fireEvent.submit(rendered.getByRole('button', { name: 'Create' }).closest('form') as HTMLFormElement)

    assert.equal(submittedPath, 'src/Main.java')
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('FileNameModal still rejects traversal paths after normalization', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const { default: FileNameModal } = await import('./FileNameModal')

  try {
    let submittedPath = ''
    const rendered = render(
      <FileNameModal
        open
        title="Create file"
        submitLabel="Create"
        onClose={() => {}}
        onSubmit={(path) => {
          submittedPath = path
        }}
      />,
    )

    fireEvent.change(rendered.getByLabelText('Path'), {
      target: { value: '../Main.java' },
    })

    assert.equal(rendered.getByRole('button', { name: 'Create' }).hasAttribute('disabled'), true)
    assert.equal(submittedPath, '')
  } finally {
    cleanup()
    restoreDom()
  }
})

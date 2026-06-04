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

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  })
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Node = dom.window.Node

  return () => {
    globalThis.document?.body?.replaceChildren()
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    globalThis.HTMLElement = previousHTMLElement
    globalThis.Node = previousNode
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

void test('VirtualFileExplorer supports tree keyboard navigation across visible items', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    const rendered = render(
      <VirtualFileExplorer
        files={{
          'src/index.ts': '',
          'src/utils/math.ts': '',
          'README.md': '',
        }}
      />,
    )

    const srcFolder = rendered.getByRole('treeitem', { name: /src/i }) as HTMLButtonElement
    srcFolder.focus()

    fireEvent.keyDown(srcFolder, { key: 'ArrowRight' })
    fireEvent.keyDown(srcFolder, { key: 'ArrowRight' })
    assert.equal(document.activeElement?.textContent?.includes('utils'), true)

    const utilsFolder = document.activeElement as HTMLButtonElement
    fireEvent.keyDown(utilsFolder, { key: 'ArrowDown' })
    assert.equal(document.activeElement?.textContent?.includes('index.ts'), true)

    const indexFile = document.activeElement as HTMLButtonElement
    fireEvent.keyDown(indexFile, { key: 'ArrowDown' })
    assert.equal(document.activeElement?.textContent?.includes('README.md'), true)

    fireEvent.keyDown(document.activeElement as HTMLButtonElement, { key: 'ArrowUp' })
    assert.equal(document.activeElement?.textContent?.includes('index.ts'), true)

    fireEvent.keyDown(document.activeElement as HTMLButtonElement, { key: 'Home' })
    assert.equal(document.activeElement?.textContent?.includes('src'), true)

    fireEvent.keyDown(document.activeElement as HTMLButtonElement, { key: 'End' })
    assert.equal(document.activeElement?.textContent?.includes('README.md'), true)
  } finally {
    cleanup()
    restoreDom()
  }
})

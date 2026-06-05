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

void test('VirtualFileExplorer renders icon buttons for file and folder creation', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    const rendered = render(
      <VirtualFileExplorer
        files={{}}
        allowCreate
      />,
    )

    assert.equal(rendered.getByRole('button', { name: 'Add file' }).getAttribute('title'), 'Add file')
    assert.equal(rendered.getByRole('button', { name: 'Add folder' }).getAttribute('title'), 'Add folder')
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('VirtualFileExplorer disables create buttons when handlers are missing', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    const rendered = render(
      <VirtualFileExplorer
        files={{}}
        allowCreate
      />,
    )

    assert.equal((rendered.getByRole('button', { name: 'Add file' }) as HTMLButtonElement).disabled, true)
    assert.equal((rendered.getByRole('button', { name: 'Add folder' }) as HTMLButtonElement).disabled, true)
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('VirtualFileExplorer accepts dropped files when uploads are enabled', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    const droppedFile = new File(['class Main {}'], 'Main.java', { type: 'text/plain' })
    let droppedFiles: File[] = []

    const rendered = render(
      <VirtualFileExplorer
        files={{}}
        onDropFiles={(files) => {
          droppedFiles = files
        }}
        dropPrompt="Drop files or zip archives here to import"
      />,
    )

    const explorer = rendered.container.firstElementChild as HTMLDivElement
    fireEvent.dragEnter(explorer, {
      dataTransfer: {
        files: [droppedFile],
        types: ['Files'],
      },
    })

    assert.equal(rendered.queryByText('Drop files or zip archives here to import') !== null, true)

    fireEvent.drop(explorer, {
      dataTransfer: {
        files: [droppedFile],
        types: ['Files'],
      },
    })

    assert.equal(droppedFiles.length, 1)
    assert.equal(droppedFiles[0]?.name, 'Main.java')
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('VirtualFileExplorer expands ancestor folders for an externally controlled active file', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    const rendered = render(
      <VirtualFileExplorer
        files={{
          'src/utils/math.ts': '',
          'README.md': '',
        }}
        activePath="src/utils/math.ts"
      />,
    )

    const srcFolder = rendered.getByRole('treeitem', { name: 'src' })
    const utilsFolder = rendered.getByRole('treeitem', { name: 'utils' })
    const mathFile = rendered.getByRole('treeitem', { name: 'math.ts' })

    assert.equal(srcFolder.getAttribute('aria-expanded'), 'true')
    assert.equal(utilsFolder.getAttribute('aria-expanded'), 'true')
    assert.equal(mathFile.getAttribute('aria-selected'), 'true')
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('VirtualFileExplorer auto-expands ancestors for normalized file keys and active paths', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    const rendered = render(
      <VirtualFileExplorer
        files={{
          '\\src\\\\utils//math.ts': '',
        }}
        activePath="/src/utils/math.ts"
      />,
    )

    const srcFolder = rendered.getByRole('treeitem', { name: 'src' })
    const utilsFolder = rendered.getByRole('treeitem', { name: 'utils' })
    const mathFile = rendered.getByRole('treeitem', { name: 'math.ts' })

    assert.equal(srcFolder.getAttribute('aria-expanded'), 'true')
    assert.equal(utilsFolder.getAttribute('aria-expanded'), 'true')
    assert.equal(mathFile.getAttribute('aria-selected'), 'true')
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('VirtualFileExplorer emits the original raw file key when a normalized entry is selected', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    let selectedPath = ''
    const rendered = render(
      <VirtualFileExplorer
        files={{
          '\\src\\\\utils//math.ts': '',
        }}
        onSelect={(path) => {
          selectedPath = path
        }}
      />,
    )

    fireEvent.click(rendered.getByRole('treeitem', { name: 'src' }))
    fireEvent.click(rendered.getByRole('treeitem', { name: 'utils' }))
    fireEvent.click(rendered.getByRole('treeitem', { name: 'math.ts' }))

    assert.equal(selectedPath, '\\src\\\\utils//math.ts')
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('VirtualFileExplorer disables rename and delete actions when handlers are missing', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    const rendered = render(
      <VirtualFileExplorer
        files={{ 'Main.java': '' }}
        allowRename
        allowDelete
      />,
    )

    fireEvent.mouseOver(rendered.getByRole('treeitem', { name: 'Main.java' }))
    assert.equal((rendered.getByRole('button', { name: 'Rename Main.java' }) as HTMLButtonElement).disabled, true)
    assert.equal((rendered.getByRole('button', { name: 'Delete Main.java' }) as HTMLButtonElement).disabled, true)
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('VirtualFileExplorer emits original raw file keys for rename and delete actions', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const { default: VirtualFileExplorer } = await import('./VirtualFileExplorer')

  try {
    let renamedPath = ''
    let deletedPath = ''
    const rendered = render(
      <VirtualFileExplorer
        files={{
          '\\src\\\\utils//math.ts': '',
        }}
        allowRename
        allowDelete
        onRename={(path) => {
          renamedPath = path
        }}
        onDelete={(path) => {
          deletedPath = path
        }}
      />,
    )

    fireEvent.click(rendered.getByRole('treeitem', { name: 'src' }))
    fireEvent.click(rendered.getByRole('treeitem', { name: 'utils' }))
    fireEvent.mouseOver(rendered.getByRole('treeitem', { name: 'math.ts' }))
    fireEvent.click(rendered.getByRole('button', { name: 'Rename math.ts' }))
    fireEvent.click(rendered.getByRole('button', { name: 'Delete math.ts' }))

    assert.equal(renamedPath, '\\src\\\\utils//math.ts')
    assert.equal(deletedPath, '\\src\\\\utils//math.ts')
  } finally {
    cleanup()
    restoreDom()
  }
})

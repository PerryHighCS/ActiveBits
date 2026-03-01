import assert from 'node:assert/strict'
import test from 'node:test'
import { loadYoutubeIframeApi, resetYoutubeIframeApiForTests, type YoutubeNamespace } from './youtubeIframeApi.js'

class MockScriptElement {
  id = ''
  src = ''
  async = false
  onerror: ((event: Event | string) => void) | null = null
  removed = false

  remove(): void {
    this.removed = true
  }
}

interface MockHead {
  scripts: MockScriptElement[]
  appendChild(node: MockScriptElement): void
}

interface MockDocument {
  head: MockHead
  createElement(tagName: string): MockScriptElement
  getElementById(id: string): MockScriptElement | null
}

interface MockWindowLike {
  YT?: YoutubeNamespace
  onYouTubeIframeAPIReady?: () => void
  __videoSyncYouTubeReadyCallbacks?: Array<() => void>
  setTimeout(handler: () => void, timeoutMs?: number): number
  clearTimeout(id: number): void
}

function installMockDom() {
  const scripts: MockScriptElement[] = []
  const timeoutHandlers = new Map<number, () => void>()
  let nextTimeoutId = 1

  const head: MockHead = {
    scripts,
    appendChild(node) {
      scripts.push(node)
    },
  }

  const documentMock: MockDocument = {
    head,
    createElement(tagName: string) {
      assert.equal(tagName, 'script')
      return new MockScriptElement()
    },
    getElementById(id: string) {
      return scripts.find((script) => script.id === id && !script.removed) ?? null
    },
  }

  const windowMock: MockWindowLike = {
    setTimeout(handler) {
      const id = nextTimeoutId
      nextTimeoutId += 1
      timeoutHandlers.set(id, handler)
      return id
    },
    clearTimeout(id) {
      timeoutHandlers.delete(id)
    },
  }

  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalHtmlScriptElement = globalThis.HTMLScriptElement

  Object.assign(globalThis, {
    window: windowMock,
    document: documentMock,
    HTMLScriptElement: MockScriptElement,
  })

  return {
    scripts,
    runNextTimeout() {
      const [id, handler] = timeoutHandlers.entries().next().value as [number, () => void]
      timeoutHandlers.delete(id)
      handler()
    },
    restore() {
      resetYoutubeIframeApiForTests()
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window')
      } else {
        Object.assign(globalThis, { window: originalWindow })
      }

      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document')
      } else {
        Object.assign(globalThis, { document: originalDocument })
      }

      if (originalHtmlScriptElement === undefined) {
        Reflect.deleteProperty(globalThis, 'HTMLScriptElement')
      } else {
        Object.assign(globalThis, { HTMLScriptElement: originalHtmlScriptElement })
      }
    },
    windowMock,
  }
}

void test('loadYoutubeIframeApi retries after script load failure and recreates the script tag', async () => {
  const mockDom = installMockDom()

  try {
    const firstLoadPromise = loadYoutubeIframeApi()
    assert.equal(mockDom.scripts.length, 1)

    mockDom.scripts[0]?.onerror?.(new Event('error'))
    await assert.rejects(firstLoadPromise, /failed to load/)
    assert.equal(mockDom.scripts[0]?.removed, true)

    const secondLoadPromise = loadYoutubeIframeApi()
    assert.equal(mockDom.scripts.length, 2)
    assert.notEqual(mockDom.scripts[0], mockDom.scripts[1])

    mockDom.windowMock.YT = {
      Player: class MockPlayer {} as unknown as YoutubeNamespace['Player'],
    }
    mockDom.windowMock.onYouTubeIframeAPIReady?.()

    const namespace = await secondLoadPromise
    assert.equal(namespace, mockDom.windowMock.YT)
  } finally {
    mockDom.restore()
  }
})

void test('loadYoutubeIframeApi clears cached promise after timeout so callers can retry', async () => {
  const mockDom = installMockDom()

  try {
    const firstLoadPromise = loadYoutubeIframeApi()
    mockDom.runNextTimeout()
    await assert.rejects(firstLoadPromise, /within timeout/)
    assert.equal(mockDom.scripts[0]?.removed, true)

    const secondLoadPromise = loadYoutubeIframeApi()
    assert.equal(mockDom.scripts.length, 2)

    mockDom.windowMock.YT = {
      Player: class MockPlayer {} as unknown as YoutubeNamespace['Player'],
    }
    mockDom.windowMock.onYouTubeIframeAPIReady?.()

    const namespace = await secondLoadPromise
    assert.equal(namespace, mockDom.windowMock.YT)
  } finally {
    mockDom.restore()
  }
})

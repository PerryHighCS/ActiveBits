import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import QrScannerPanelView from './QrScannerPanelView'

function installDomEnvironment(url = 'https://bits.example') {
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

void test('QrScannerPanelView renders custom title and video state', () => {
  const html = renderToStaticMarkup(
    <QrScannerPanelView
      errorCode={null}
      title="Scan review QR code"
    />,
  )

  assert.match(html, /Scan review QR code/)
  assert.match(html, /role="dialog"/)
  assert.match(html, /aria-modal="true"/)
  assert.match(html, /<video/)
  assert.match(html, /aria-label="QR code scanner video feed"/)
  assert.doesNotMatch(html, /aria-describedby=/)
})

void test('QrScannerPanelView renders custom error copy with dialog description and live region', () => {
  const html = renderToStaticMarkup(
    <QrScannerPanelView
      errorCode="camera-error"
      errorMessage="Use your camera app to open the QR code instead."
      title="Scan review QR code"
    />,
  )
  const document = new JSDOM(html).window.document
  const dialog = document.querySelector('[role="dialog"]')
  const error = document.querySelector('[role="alert"]')

  assert.notEqual(dialog, null)
  assert.notEqual(error, null)
  assert.equal(dialog?.getAttribute('aria-describedby'), error?.id)
  assert.equal(error?.getAttribute('aria-live'), 'assertive')
  assert.equal(error?.getAttribute('aria-atomic'), 'true')
  assert.equal(error?.textContent, 'Use your camera app to open the QR code instead.')
})

void test('QrScannerPanelView wires close callbacks from button and Escape', async () => {
  const restoreDom = installDomEnvironment()
  const { cleanup, fireEvent, render } = await import('@testing-library/react')
  const closeReasons: string[] = []

  try {
    const rendered = render(
      <QrScannerPanelView
        errorCode={null}
        onClose={() => closeReasons.push('closed')}
        title="Scan QR Code"
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(rendered.getByRole('dialog'), { key: 'Escape' })

    assert.deepEqual(closeReasons, ['closed', 'closed'])
  } finally {
    cleanup()
    restoreDom()
  }
})

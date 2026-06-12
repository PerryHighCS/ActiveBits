import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DetectedBarcode } from 'react-zxing'
import QrScannerPanel, { type QrScannerHook } from './QrScannerPanel'
import QrScannerPanelView from './QrScannerPanelView'

type QrScannerHookOptions = Parameters<QrScannerHook>[0]

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
      onClose={() => {}}
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
      onClose={() => {}}
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

void test('QrScannerPanelView traps Tab focus and restores prior focus on unmount', async () => {
  const restoreDom = installDomEnvironment()
  const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')
  const priorButton = document.createElement('button')
  priorButton.type = 'button'
  priorButton.textContent = 'Before scanner'
  document.body.append(priorButton)
  priorButton.focus()

  try {
    const rendered = render(
      <QrScannerPanelView
        errorCode={null}
        onClose={() => {}}
        title="Scan QR Code"
      />,
    )
    const dialog = rendered.getByRole('dialog')
    const closeButton = rendered.getByRole('button', { name: 'Close' })
    const video = rendered.getByLabelText('QR code scanner video feed')

    await waitFor(() => assert.equal(document.activeElement, closeButton))

    video.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    assert.equal(document.activeElement, closeButton)

    closeButton.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    assert.equal(document.activeElement, video)

    rendered.unmount()
    assert.equal(document.activeElement, priorButton)
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('QrScannerPanel mounts the public scanner wrapper and wires scanner options', async () => {
  const restoreDom = installDomEnvironment()
  const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')
  const detectedTexts: string[] = []
  const errorCodes: string[] = []
  const rawErrors: unknown[] = []
  const closeReasons: string[] = []
  let latestOptions: QrScannerHookOptions | undefined

  const scannerHook: QrScannerHook = (options) => {
    latestOptions = options
    return {
      ref: { current: null },
      torch: {
        isOn: false,
        isAvailable: false,
        on: async () => {},
        off: async () => {},
      },
    }
  }

  try {
    const rendered = render(
      <QrScannerPanel
        title="Scan review QR code"
        errorMessage="Use your camera app to open the QR code instead."
        formats={['qr_code']}
        onDetected={(text) => detectedTexts.push(text)}
        onError={(code, error) => {
          errorCodes.push(code)
          rawErrors.push(error)
        }}
        onClose={() => closeReasons.push('closed')}
        scannerHook={scannerHook}
        timeBetweenDecodingAttempts={450}
      />,
    )

    assert.notEqual(rendered.queryByText('Scan review QR code'), null)
    assert.deepEqual(latestOptions?.formats, ['qr_code'])
    assert.equal(latestOptions?.timeBetweenDecodingAttempts, 450)
    assert.equal(latestOptions?.wasmUrl?.endsWith('zxing_reader.wasm'), true)

    act(() => {
      latestOptions?.onDecodeResult?.({
        rawValue: 'https://bits.example/session-1',
        format: 'qr_code',
        boundingBox: {} as DOMRectReadOnly,
        cornerPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      } satisfies DetectedBarcode)
    })
    assert.deepEqual(detectedTexts, ['https://bits.example/session-1'])

    act(() => {
      latestOptions?.onError?.({ name: 'NotAllowedError' })
    })
    assert.equal(errorCodes.length, 0)

    rendered.unmount()

    const errorRendered = render(
      <QrScannerPanel
        title="Scan review QR code"
        errorMessage="Use your camera app to open the QR code instead."
        onClose={() => closeReasons.push('closed')}
        onError={(code, error) => {
          errorCodes.push(code)
          rawErrors.push(error)
        }}
        scannerHook={scannerHook}
      />,
    )

    const cameraError = { name: 'NotAllowedError' }
    act(() => {
      latestOptions?.onError?.(cameraError)
    })

    await waitFor(() => {
      assert.notEqual(errorRendered.queryByRole('alert'), null)
    })
    assert.equal(errorRendered.getByRole('alert').textContent, 'Use your camera app to open the QR code instead.')
    assert.deepEqual(errorCodes, ['camera-error'])
    assert.deepEqual(rawErrors, [cameraError])

    fireEvent.click(errorRendered.getByRole('button', { name: 'Close' }))
    assert.deepEqual(closeReasons, ['closed'])
  } finally {
    cleanup()
    restoreDom()
  }
})

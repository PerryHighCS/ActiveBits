import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { QrScannerPanelProps } from '@src/components/common/QrScannerPanel';
import ReviewerScanner from './ReviewerScanner.js';

function installDomEnvironment(url = 'https://bits.example/session-1') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousHTMLElement = globalThis.HTMLElement;
  const previousNode = globalThis.Node;

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis;
  ;(globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;

  return () => {
    globalThis.document?.body?.replaceChildren();
    dom.window.close();
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow;
    ;(globalThis as { document?: Document }).document = previousDocument;
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.Node = previousNode;
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  };
}

function TestScannerPanel({
  errorMessage,
  formats,
  onDetected,
  onError,
  timeBetweenDecodingAttempts,
  title,
}: QrScannerPanelProps): React.JSX.Element {
  return (
    <section aria-label="test scanner">
      <h2>{title}</h2>
      <p>{errorMessage}</p>
      <p>formats:{formats?.join(',') ?? ''}</p>
      <p>interval:{timeBetweenDecodingAttempts}</p>
      <button type="button" onClick={() => onError?.('camera-error', { name: 'NotAllowedError' })}>
        scanner error
      </button>
      <button type="button" onClick={() => onDetected?.('not a valid url')}>
        invalid QR
      </button>
    </section>
  );
}

void test('ReviewerScanner maps scanner errors to Gallery Walk unavailable state without closing', async () => {
  const restoreDom = installDomEnvironment();
  const { cleanup, fireEvent, render } = await import('@testing-library/react');
  const errors: Array<string | null> = [];
  let closeCount = 0;

  try {
    const rendered = render(
      <ReviewerScanner
        isOpen
        sessionId="session-1"
        onClose={() => {
          closeCount += 1;
        }}
        onError={(code) => errors.push(code)}
        onSuccess={() => {
          throw new Error('onSuccess should not be called for scanner failures');
        }}
        ScannerPanelComponent={TestScannerPanel}
      />,
    );

    assert.notEqual(rendered.queryByText('Scan review QR code'), null);
    assert.notEqual(
      rendered.queryByText('Unable to scan from this browser. Use your camera app to open the QR code instead.'),
      null,
    );
    assert.notEqual(rendered.queryByText('formats:qr_code'), null);
    assert.notEqual(rendered.queryByText('interval:300'), null);

    fireEvent.click(rendered.getByRole('button', { name: 'scanner error' }));

    assert.deepEqual(errors, ['scanner-unavailable']);
    assert.equal(closeCount, 0);
  } finally {
    cleanup();
    restoreDom();
  }
});

void test('ReviewerScanner closes and reports scanner-invalid for invalid QR payloads', async () => {
  const restoreDom = installDomEnvironment();
  const { cleanup, fireEvent, render } = await import('@testing-library/react');
  const errors: Array<string | null> = [];
  let closeCount = 0;

  try {
    const rendered = render(
      <ReviewerScanner
        isOpen
        sessionId="session-1"
        onClose={() => {
          closeCount += 1;
        }}
        onError={(code) => errors.push(code)}
        onSuccess={() => {
          throw new Error('onSuccess should not be called for invalid QR payloads');
        }}
        ScannerPanelComponent={TestScannerPanel}
      />,
    );

    fireEvent.click(rendered.getByRole('button', { name: 'invalid QR' }));

    assert.deepEqual(errors, [null, 'scanner-invalid']);
    assert.equal(closeCount, 1);
  } finally {
    cleanup();
    restoreDom();
  }
});

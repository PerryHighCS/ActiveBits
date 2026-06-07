import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import SessionHeader from './SessionHeader'
import { buildStudentJoinUrl } from './sessionHeaderUtils'

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

void test('SessionHeader simple mode renders only the activity title', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader activityName="Raffle" simple />
    </MemoryRouter>,
  )

  assert.match(html, /Raffle/)
  assert.doesNotMatch(html, /Join Code:/)
})

void test('SessionHeader full mode renders join controls and action buttons', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader activityName="Gallery Walk" sessionId="abc123" />
    </MemoryRouter>,
  )

  assert.match(html, /Gallery Walk/)
  assert.match(html, /Join Code:/)
  assert.match(html, /abc123/)
  assert.match(html, /Copy Join URL/)
  assert.match(html, /End Session/)
  assert.match(html, /mb-6/)
})

void test('buildStudentJoinUrl encodes reserved session id characters', () => {
  assert.equal(
    buildStudentJoinUrl('https://example.test', 'CHILD:abc/def?x=1'),
    'https://example.test/CHILD%3Aabc%2Fdef%3Fx%3D1',
  )
})

void test('SessionHeader can opt out of default bottom margin', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader activityName="Mob Code" sessionId="abc123" includeBottomMargin={false} />
    </MemoryRouter>,
  )

  assert.doesNotMatch(html, /mb-6/)
})

void test('SessionHeader can render an activity action menu trigger', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader
        activityName="Mob Code"
        sessionId="abc123"
        actionMenuLabel="Code Files"
        actionMenuRole="menu"
        actionMenuContent={<button type="button" role="menuitem">Upload Zip</button>}
        headerActions={<button type="button">Theme</button>}
      />
    </MemoryRouter>,
  )

  assert.match(html, /Code Files/)
  assert.match(html, /Theme/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-haspopup="menu"/)
  assert.doesNotMatch(html, /role="menu"/)
  assert.doesNotMatch(html, /aria-controls=/)
  assert.doesNotMatch(html, /Upload Zip/)
})

void test('SessionHeader leaves action popup semantics neutral by default', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader
        activityName="Mob Code"
        sessionId="abc123"
        actionMenuLabel="Details"
        actionMenuContent={<div>Summary</div>}
      />
    </MemoryRouter>,
  )

  assert.doesNotMatch(html, /aria-haspopup=/)
  assert.doesNotMatch(html, /aria-controls=/)
  assert.doesNotMatch(html, /role="menu"/)
})

void test('SessionHeader action menu supports focus and keyboard dismissal', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const rendered = render(
      <MemoryRouter>
        <SessionHeader
          activityName="Mob Code"
          sessionId="abc123"
          actionMenuLabel="Files"
          actionMenuRole="menu"
          actionMenuContent={(
            <>
              <button type="button" role="menuitem">New File</button>
              <input type="file" aria-label="Hidden upload input" style={{ display: 'none' }} />
              <button type="button" role="menuitem">Upload Zip</button>
            </>
          )}
        />
      </MemoryRouter>,
    )

    const trigger = rendered.getByRole('button', { name: 'Files' })
    fireEvent.click(trigger)

    const newFileButton = await waitFor(() => rendered.getByRole('menuitem', { name: 'New File' }))
    await waitFor(() => assert.equal(document.activeElement, newFileButton))

    fireEvent.keyDown(rendered.getByRole('menu', { name: 'Files' }), { key: 'ArrowDown' })
    assert.equal(document.activeElement, rendered.getByRole('menuitem', { name: 'Upload Zip' }))

    fireEvent.keyDown(rendered.getByRole('menu', { name: 'Files' }), { key: 'ArrowDown' })
    assert.equal(document.activeElement, newFileButton)

    fireEvent.keyDown(rendered.getByRole('menu', { name: 'Files' }), { key: 'Home' })
    assert.equal(document.activeElement, newFileButton)

    fireEvent.keyDown(rendered.getByRole('menu', { name: 'Files' }), { key: 'Escape' })
    await waitFor(() => assert.equal(rendered.queryByRole('menu', { name: 'Files' }), null))
    await waitFor(() => assert.equal(document.activeElement, trigger))
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('SessionHeader action menu closes on outside click', async () => {
  const restoreDom = installDomEnvironment('https://bits.example')
  const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const rendered = render(
      <MemoryRouter>
        <SessionHeader
          activityName="Mob Code"
          sessionId="abc123"
          actionMenuLabel="Files"
          actionMenuContent={<button type="button">New File</button>}
        />
      </MemoryRouter>,
    )

    const trigger = rendered.getByRole('button', { name: 'Files' })
    fireEvent.click(trigger)
    await waitFor(() => assert.notEqual(rendered.queryByRole('button', { name: 'New File' }), null))

    fireEvent.mouseDown(document.body)
    await waitFor(() => assert.equal(rendered.queryByRole('button', { name: 'New File' }), null))
    assert.notEqual(document.activeElement, trigger)
  } finally {
    cleanup()
    restoreDom()
  }
})

void test('SessionHeader can render centered activity controls', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader
        activityName="Mob Code"
        sessionId="abc123"
        headerActions={<button type="button">Theme</button>}
        centerHeaderActions={<button type="button">Run</button>}
      />
    </MemoryRouter>,
  )

  assert.match(html, /Theme/)
  assert.match(html, /Run/)
  assert.match(html, /md:left-1\/2/)
  assert.match(html, /justify-center/)
})

void test('SessionHeader hides join and end controls but keeps activity controls for embedded child sessions', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader
        activityName="Embedded Test"
        sessionId="CHILD:parent:abc12:embedded-test"
        actionMenuLabel="Files"
        actionMenuContent={<button type="button">New File</button>}
        headerActions={<button type="button">Theme</button>}
        centerHeaderActions={<button type="button">Run</button>}
      />
    </MemoryRouter>,
  )

  assert.match(html, /Files/)
  assert.match(html, /Theme/)
  assert.match(html, /Run/)
  assert.match(html, /md:left-1\/2/)
  assert.doesNotMatch(html, /Managed by SyncDeck/i)
  assert.doesNotMatch(html, /Embedded session managed/i)
  assert.doesNotMatch(html, /Join Code:/)
  assert.doesNotMatch(html, /End Session/)
  assert.match(html, /mb-6/)
})

void test('SessionHeader embedded child mode respects bottom-margin opt out', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader
        activityName="Embedded Test"
        sessionId="CHILD:parent:abc12:embedded-test"
        includeBottomMargin={false}
      />
    </MemoryRouter>,
  )

  assert.doesNotMatch(html, /mb-6/)
})

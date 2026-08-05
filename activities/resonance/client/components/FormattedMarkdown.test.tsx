import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import FormattedMarkdown, { isAllowedMarkdownUrl, plainTextFromMarkdown } from './FormattedMarkdown.js'

function installDomEnvironment(): () => void {
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

void test('FormattedMarkdown renders GFM tables, code, links, and images', () => {
  const html = renderToStaticMarkup(
    React.createElement(FormattedMarkdown, {
      markdown: [
        'Use `range`.',
        '',
        '```py',
        'for n in range(3):',
        '    print(n)',
        '```',
        '',
        '| value | count |',
        '| --- | ---: |',
        '| A | 2 |',
        '',
        '[Docs](https://example.com/docs)',
        '',
        '![Chart](https://example.com/chart.png)',
      ].join('\n'),
    }),
  )

  assert.match(html, /<code/)
  assert.match(html, /language-py/)
  assert.match(html, /<pre[\s\S]*<code class="font-mono text-inherit language-py">/)
  assert.match(html, /<table/)
  assert.match(html, /href="https:\/\/example.com\/docs"/)
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.match(html, /src="https:\/\/example.com\/chart.png"/)
  assert.match(html, /alt="Chart"/)
})

void test('FormattedMarkdown skips raw HTML and blocks unsafe image and link URLs', () => {
  const html = renderToStaticMarkup(
    React.createElement(FormattedMarkdown, {
      markdown: [
        '<script>alert("x")</script>',
        '[bad](javascript:alert(1))',
        '![bad](file:///tmp/image.png)',
        '![svg](data:image/svg+xml;base64,PHN2Zy8+)',
        '![png](data:image/png;base64,AAAA)',
      ].join('\n'),
    }),
  )

  assert.doesNotMatch(html, /script/)
  assert.doesNotMatch(html, /javascript:/)
  assert.doesNotMatch(html, /file:\/\//)
  assert.doesNotMatch(html, /image\/svg\+xml/)
  assert.match(html, />bad</)
  assert.doesNotMatch(html, /<a[^>]*>bad<\/a>/)
  assert.match(html, /data:image\/png;base64,AAAA/)
})

void test('FormattedMarkdown does not render interactive task list inputs', () => {
  const html = renderToStaticMarkup(
    React.createElement(FormattedMarkdown, {
      markdown: '- [ ] Draft answer\n- [x] Review answer',
    }),
  )

  assert.doesNotMatch(html, /<input\b/)
  assert.match(html, /Draft answer/)
  assert.match(html, /Review answer/)
})

void test('FormattedMarkdown preserves image nodes across unrelated manager renders', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const rendered = render(React.createElement(FormattedMarkdown, {
      markdown: '![Diagram](https://example.com/diagram.png)',
    }))
    const originalImage = rendered.getByRole('img', { name: 'Diagram' })

    rendered.rerender(React.createElement(FormattedMarkdown, {
      markdown: '![Diagram](https://example.com/diagram.png)',
    }))

    assert.equal(rendered.getByRole('img', { name: 'Diagram' }), originalImage)
    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('Markdown URL and plain-text helpers match the classroom authoring contract', () => {
  assert.equal(isAllowedMarkdownUrl('https://example.com/image.png', 'image'), true)
  assert.equal(isAllowedMarkdownUrl('http://example.com/image.png', 'image'), true)
  assert.equal(isAllowedMarkdownUrl('data:image/png;base64,AAAA', 'image'), true)
  assert.equal(isAllowedMarkdownUrl('data:image/svg+xml;base64,AAAA', 'image'), false)
  assert.equal(isAllowedMarkdownUrl('javascript:alert(1)', 'link'), false)
  assert.equal(plainTextFromMarkdown('Pick `[3]` from **the list** ![plot](https://example.com/plot.png)'), 'Pick [3] from the list plot')
})

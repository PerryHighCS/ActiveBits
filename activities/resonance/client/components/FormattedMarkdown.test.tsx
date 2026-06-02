import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FormattedMarkdown, { isAllowedMarkdownUrl, plainTextFromMarkdown } from './FormattedMarkdown.js'

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

void test('Markdown URL and plain-text helpers match the classroom authoring contract', () => {
  assert.equal(isAllowedMarkdownUrl('https://example.com/image.png', 'image'), true)
  assert.equal(isAllowedMarkdownUrl('http://example.com/image.png', 'image'), true)
  assert.equal(isAllowedMarkdownUrl('data:image/png;base64,AAAA', 'image'), true)
  assert.equal(isAllowedMarkdownUrl('data:image/svg+xml;base64,AAAA', 'image'), false)
  assert.equal(isAllowedMarkdownUrl('javascript:alert(1)', 'link'), false)
  assert.equal(plainTextFromMarkdown('Pick `[3]` from **the list** ![plot](https://example.com/plot.png)'), 'Pick [3] from the list plot')
})

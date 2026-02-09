import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import PseudocodeRenderer from './PseudocodeRenderer'

void test('PseudocodeRenderer supports highlight arrays and overlay values', () => {
  const html = renderToStaticMarkup(
    <PseudocodeRenderer
      lines={['line one', 'line two']}
      highlightedLines={['line-1']}
      overlays={{ 'line-1': { value: 42 } }}
    />,
  )

  assert.match(html, /id="line-1"/)
  assert.match(html, /highlighted/)
  assert.match(html, /has-overlay/)
  assert.match(html, /overlay-value/)
  assert.match(html, />42</)
})

void test('PseudocodeRenderer supports highlightedIds compatibility path', () => {
  const html = renderToStaticMarkup(
    <PseudocodeRenderer
      lines={['line one']}
      highlightedIds={new Set(['line-0'])}
      overlays={{ 'line-0': 'NOTE' }}
    />,
  )

  assert.match(html, /id="line-0"/)
  assert.match(html, /highlighted/)
  assert.match(html, /overlay-badge/)
  assert.match(html, />NOTE</)
})

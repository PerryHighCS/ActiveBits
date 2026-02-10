import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderBoldText, renderPseudocodeWithBold } from './pseudocodeUtils.js'

void test('renderBoldText tokenizes markdown-style bold spans', () => {
  const tokens = renderBoldText('**function** mergeSort(arr)')

  assert.deepEqual(tokens, [
    { type: 'bold', content: 'function' },
    { type: 'text', content: ' mergeSort(arr)' },
  ])
})

void test('renderPseudocodeWithBold returns strong tags for bold spans', () => {
  const html = renderToStaticMarkup(<>{renderPseudocodeWithBold('if **x** then')}</>)

  assert.match(html, /if /)
  assert.match(html, /<strong>x<\/strong>/)
  assert.match(html, / then/)
})

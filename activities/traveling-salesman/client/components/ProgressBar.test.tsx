import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ProgressBar from './ProgressBar'

void test('ProgressBar renders label and clamped width', () => {
  const html = renderToStaticMarkup(React.createElement(ProgressBar, { value: 150, max: 100, label: 'Load' }))
  assert.match(html, /Load/)
  assert.match(html, /width:100%/)
})

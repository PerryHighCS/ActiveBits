import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RouteLegend from './RouteLegend'

test('RouteLegend renders labels and brute-force progress', () => {
  const html = renderToStaticMarkup(
    React.createElement(RouteLegend, {
      title: 'Legend',
      items: [
        { id: 'h1', type: 'heuristic', label: 'Heuristic', distance: 10 },
        { id: 'b1', type: 'bruteforce', label: 'Brute', progressCurrent: 2, progressTotal: 5 },
      ],
    }),
  )

  assert.match(html, /Legend/)
  assert.match(html, /Heuristic \(10\.0\)/)
  assert.match(html, /Brute force checks: 2\/5/)
})

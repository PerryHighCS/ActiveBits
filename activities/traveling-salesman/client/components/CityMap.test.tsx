import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CityMap from './CityMap'

void test('CityMap renders city labels and route edges', () => {
  const html = renderToStaticMarkup(
    React.createElement(CityMap, {
      cities: [
        { id: 'city-0', x: 100, y: 100, name: 'Alpha' },
        { id: 'city-1', x: 200, y: 200, name: 'Beta' },
      ],
      routes: [
        { id: 'r1', type: 'student', path: ['city-0', 'city-1'], name: 'Route 1', distance: 5 },
      ],
      distanceMatrix: [
        [0, 5],
        [5, 0],
      ],
      terrainSeed: 123,
    }),
  )

  assert.match(html, /Alpha/)
  assert.match(html, /Beta/)
  assert.match(html, /route-group/)
})

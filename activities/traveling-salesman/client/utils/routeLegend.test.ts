import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLegendItems, dedupeLegendItems } from './routeLegend'

void test('buildLegendItems includes primary and mapped route items', () => {
  const items = buildLegendItems({
    primary: { id: 'primary', type: 'student', label: 'Primary' },
    routes: [
      { id: 'r1', type: 'heuristic', name: 'Heuristic', distance: 10 },
    ],
  })

  assert.equal(items.length, 2)
  assert.equal(items[0]?.id, 'primary')
  assert.equal(items[1]?.label, 'Heuristic')
})

void test('dedupeLegendItems keeps the latest item for duplicate ids', () => {
  const deduped = dedupeLegendItems([
    { id: 'x', type: 'student', label: 'First' },
    { id: 'x', type: 'student', label: 'Second' },
  ])

  assert.equal(deduped.length, 1)
  assert.equal(deduped[0]?.label, 'Second')
})

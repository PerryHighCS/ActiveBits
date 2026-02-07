/**
 * Dev-only validation and tests for algorithm registry integrity
 * Run with: npm test --workspace client (filtered by this file name)
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { getAllAlgorithms, validateAlgorithmRegistry } from '../algorithms/index'

test('algorithm registry - validate structure', () => {
  const result = validateAlgorithmRegistry()

  assert.ok(result.valid, `Registry valid: ${result.errors.join(', ')}`)
  assert.equal(result.count, 8, 'Expected 8 algorithms registered')
  assert.deepEqual(result.errors, [], 'No validation errors')
})

test('algorithm registry - all algorithms have required fields', async (t) => {
  const algorithms = getAllAlgorithms()

  for (const algo of algorithms) {
    await t.test(`algorithm ${algo.id}`, () => {
      const algorithmId = typeof algo.id === 'string' ? algo.id : ''
      const pseudocode = Array.isArray(algo.pseudocode) ? algo.pseudocode : []
      assert.ok(algorithmId, `${algorithmId}: has id`)
      assert.ok(algo.name, `${algorithmId}: has name`)
      assert.ok(algo.description, `${algorithmId}: has description`)
      assert.ok(Array.isArray(algo.pseudocode), `${algorithmId}: pseudocode is array`)
      assert.ok(pseudocode.length > 0, `${algorithmId}: pseudocode not empty`)
      assert.ok(algo.category, `${algorithmId}: has category`)
      assert.ok(algo.initState || algo.StudentView, `${algorithmId}: has initState or StudentView`)
    })
  }
})

test('algorithm registry - pseudocode line references are valid', async (t) => {
  const algorithms = getAllAlgorithms()

  for (const algo of algorithms) {
    await t.test(`algorithm ${algo.id} - line references`, () => {
      if (!Array.isArray(algo.steps)) return

      const pseudocode = Array.isArray(algo.pseudocode) ? algo.pseudocode : []
      const validLineIds = new Set(pseudocode.map((_, i) => `line-${i}`))

      for (let stepIdx = 0; stepIdx < algo.steps.length; stepIdx++) {
        const step = algo.steps[stepIdx]
        if (!step) continue
        if (Array.isArray(step.highlight)) {
          for (const lineId of step.highlight) {
            assert.ok(
              validLineIds.has(lineId),
              `Step ${stepIdx} references valid line ID ${lineId}`,
            )
          }
        }
      }
    })
  }
})

test('algorithm registry - no duplicate IDs', () => {
  const algorithms = getAllAlgorithms()
  const ids = new Set<string>()

  for (const algo of algorithms) {
    const algorithmId = typeof algo.id === 'string' ? algo.id : ''
    assert.ok(algorithmId, 'Algorithm has a non-empty string id')
    assert.ok(!ids.has(algorithmId), `Algorithm ID ${algorithmId} is unique`)
    ids.add(algorithmId)
  }
})

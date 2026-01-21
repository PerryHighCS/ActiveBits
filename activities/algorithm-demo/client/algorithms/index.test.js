/**
 * Dev-only validation and tests for algorithm registry integrity
 * Run with: npm test --workspace client (filtered by this file name)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAlgorithmRegistry } from '../algorithms/index.js';

test('algorithm registry - validate structure', () => {
  const result = validateAlgorithmRegistry();
  
  assert.ok(result.valid, `Registry valid: ${result.errors.join(', ')}`);
  assert.equal(result.count, 8, 'Expected 8 algorithms registered');
  assert.deepEqual(result.errors, [], 'No validation errors');
});

test('algorithm registry - all algorithms have required fields', async (t) => {
  const { getAllAlgorithms } = await import('../algorithms/index.js');
  const algorithms = getAllAlgorithms();
  
  for (const algo of algorithms) {
    await t.test(`algorithm ${algo.id}`, () => {
      assert.ok(algo.id, `${algo.id}: has id`);
      assert.ok(algo.name, `${algo.id}: has name`);
      assert.ok(algo.description, `${algo.id}: has description`);
      assert.ok(Array.isArray(algo.pseudocode), `${algo.id}: pseudocode is array`);
      assert.ok(algo.pseudocode.length > 0, `${algo.id}: pseudocode not empty`);
      assert.ok(algo.category, `${algo.id}: has category`);
      assert.ok(algo.initState || algo.StudentView, `${algo.id}: has initState or StudentView`);
    });
  }
});

test('algorithm registry - pseudocode line references are valid', async (t) => {
  const { getAllAlgorithms } = await import('../algorithms/index.js');
  const algorithms = getAllAlgorithms();
  
  for (const algo of algorithms) {
    await t.test(`algorithm ${algo.id} - line references`, () => {
      if (!Array.isArray(algo.steps)) return;
      
      const validLineIds = new Set(algo.pseudocode.map((_, i) => `line-${i}`));
      
      for (let stepIdx = 0; stepIdx < algo.steps.length; stepIdx++) {
        const step = algo.steps[stepIdx];
        if (Array.isArray(step.highlight)) {
          for (const lineId of step.highlight) {
            assert.ok(
              validLineIds.has(lineId),
              `Step ${stepIdx} references valid line ID ${lineId}`
            );
          }
        }
      }
    });
  }
});

test('algorithm registry - no duplicate IDs', async () => {
  const { getAllAlgorithms } = await import('../algorithms/index.js');
  const algorithms = getAllAlgorithms();
  
  const ids = new Set();
  for (const algo of algorithms) {
    assert.ok(!ids.has(algo.id), `Algorithm ID ${algo.id} is unique`);
    ids.add(algo.id);
  }
});

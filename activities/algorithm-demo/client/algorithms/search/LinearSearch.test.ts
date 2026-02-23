import test from 'node:test'
import assert from 'node:assert/strict'
import LinearSearch from './LinearSearch.js'

interface LinearSearchStateLike {
  array: number[]
  initialArray: number[]
  target: number
  i: number
  found: boolean
  foundIndex: number
  substep: number
  currentStep: string | null
  highlightedLines: Set<string>
}

void test('LinearSearch initState builds expected state shape', () => {
  const state = LinearSearch.initState?.(8, null) as unknown as LinearSearchStateLike

  assert.equal(Array.isArray(state.array), true)
  assert.equal(state.array.length, 8)
  assert.deepEqual(state.initialArray, state.array)
  assert.equal(typeof state.target, 'number')
  assert.equal(state.i, 0)
  assert.equal(state.found, false)
  assert.equal(state.foundIndex, -1)
  assert.equal(state.substep, 0)
  assert.equal(state.currentStep, null)
  assert.equal(state.highlightedLines instanceof Set, true)
})

void test('LinearSearch reduceEvent advances step and supports reset', () => {
  const state = LinearSearch.initState?.(6, 42) as unknown as LinearSearchStateLike
  const next = LinearSearch.reduceEvent?.(
    state as unknown as Record<string, unknown>,
    { type: 'nextStep' },
  ) as unknown as LinearSearchStateLike

  assert.equal(next.substep, 1)
  assert.equal(next.highlightedLines.has('line-1'), true)
  assert.match(next.currentStep ?? '', /Check loop:/)

  const reset = LinearSearch.reduceEvent?.(
    {
      ...next,
      i: 4,
      found: true,
      foundIndex: 4,
      substep: 100,
    } as unknown as Record<string, unknown>,
    { type: 'reset' },
  ) as unknown as LinearSearchStateLike

  assert.equal(reset.i, 0)
  assert.equal(reset.found, false)
  assert.equal(reset.foundIndex, -1)
  assert.equal(reset.substep, 0)
  assert.deepEqual(reset.array, reset.initialArray)
})

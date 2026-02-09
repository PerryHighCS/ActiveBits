import test from 'node:test'
import assert from 'node:assert/strict'
import InsertionSort from './InsertionSort'

interface InsertionSortStateLike {
  array: number[]
  initialArray: number[]
  i: number
  j: number
  tmp: number | null
  substep: number
  sorted: boolean
  currentStep: string | null
  highlightedLines: Set<string>
  shiftedIndices: number[]
  transitionIndices: number[]
  moveAnimations: Record<number, number>
  tmpAnim: 'from-array' | 'to-array' | null
  tmpPos: number | null
}

void test('InsertionSort initState creates expected state shell', () => {
  const state = InsertionSort.initState?.(8) as unknown as InsertionSortStateLike

  assert.equal(state.array.length, 8)
  assert.deepEqual(state.initialArray, state.array)
  assert.equal(state.i, 1)
  assert.equal(state.j, 0)
  assert.equal(state.tmp, null)
  assert.equal(state.substep, 0)
  assert.equal(state.sorted, false)
  assert.equal(state.highlightedLines instanceof Set, true)
  assert.deepEqual(state.shiftedIndices, [])
  assert.deepEqual(state.transitionIndices, [])
  assert.deepEqual(state.moveAnimations, {})
  assert.equal(state.tmpAnim, null)
  assert.equal(state.tmpPos, null)
})

void test('InsertionSort reduceEvent advances first step and supports reset', () => {
  const state = InsertionSort.initState?.(6) as unknown as InsertionSortStateLike
  const next = InsertionSort.reduceEvent?.(
    state as unknown as Record<string, unknown>,
    { type: 'nextStep' },
  ) as unknown as InsertionSortStateLike

  assert.equal(next.substep, 1)
  assert.equal(next.highlightedLines.has('line-1'), true)
  assert.match(next.currentStep ?? '', /Outer loop/)

  const reset = InsertionSort.reduceEvent?.(
    {
      ...next,
      sorted: true,
      i: 4,
    } as unknown as Record<string, unknown>,
    { type: 'reset' },
  ) as unknown as InsertionSortStateLike

  assert.equal(reset.sorted, false)
  assert.equal(reset.i, 1)
  assert.equal(reset.substep, 0)
  assert.deepEqual(reset.array, reset.initialArray)
})

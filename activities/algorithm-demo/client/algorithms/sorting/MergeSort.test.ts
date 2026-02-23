import test from 'node:test'
import assert from 'node:assert/strict'
import MergeSort from './MergeSort.js'

interface MergeSortStateLike {
  array: number[]
  initialArray: number[]
  scratch: Array<number | null>
  callStack: Array<Record<string, unknown>>
  complete: boolean
  substep: number
  highlightedLines: Set<string>
  currentStep: string | null
  animFrom: string | null
  animTo: string | null
  animValue: number | null
  copiedBackIndices: number[]
  scratchWritten: number[]
}

void test('MergeSort initState creates expected state shell', () => {
  const state = MergeSort.initState?.(8) as unknown as MergeSortStateLike

  assert.equal(state.array.length, 8)
  assert.deepEqual(state.initialArray, state.array)
  assert.equal(state.scratch.length, 8)
  assert.equal(state.callStack.length, 0)
  assert.equal(state.complete, false)
  assert.equal(state.substep, 0)
  assert.equal(state.highlightedLines instanceof Set, true)
  assert.equal(state.currentStep, null)
  assert.equal(state.animFrom, null)
  assert.equal(state.animTo, null)
  assert.equal(state.animValue, null)
  assert.deepEqual(state.copiedBackIndices, [])
  assert.deepEqual(state.scratchWritten, [])
})

void test('MergeSort reduceEvent advances first step and supports reset', () => {
  const state = MergeSort.initState?.(6) as unknown as MergeSortStateLike
  const next = MergeSort.reduceEvent?.(
    state as unknown as Record<string, unknown>,
    { type: 'nextStep' },
  ) as unknown as MergeSortStateLike

  assert.equal(next.substep, 1)
  assert.equal(next.highlightedLines.has('line-0'), true)
  assert.match(next.currentStep ?? '', /Start: MergeSort/)

  const reset = MergeSort.reduceEvent?.(
    {
      ...next,
      complete: true,
      substep: 20,
      callStack: [{ function: 'MergeSortHelper' }],
    } as unknown as Record<string, unknown>,
    { type: 'reset' },
  ) as unknown as MergeSortStateLike

  assert.equal(reset.complete, false)
  assert.equal(reset.substep, 0)
  assert.deepEqual(reset.callStack, [])
  assert.deepEqual(reset.array, reset.initialArray)
  assert.equal(reset.scratch.length, reset.initialArray.length)
})

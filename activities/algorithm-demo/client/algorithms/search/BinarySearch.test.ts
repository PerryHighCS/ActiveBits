import test from 'node:test'
import assert from 'node:assert/strict'
import BinarySearch from './BinarySearch'

interface BinarySearchStateLike {
  array: number[]
  initialArray: number[]
  target: number
  left: number
  right: number
  mid: number | null
  substep: number
  found: boolean
  foundIndex: number
  currentStep: string | null
  highlightedLines: Set<string>
  history: Array<Record<string, unknown>>
}

test('BinarySearch initState creates sorted array and default pointers', () => {
  const state = BinarySearch.initState?.(10, null) as unknown as BinarySearchStateLike

  assert.equal(state.array.length, 10)
  assert.deepEqual(state.initialArray, state.array)
  assert.equal(state.left, 0)
  assert.equal(state.right, state.array.length - 1)
  assert.equal(state.mid, null)
  assert.equal(state.substep, 0)
  assert.equal(state.found, false)

  const sorted = state.array.every((value, index, list) => index === 0 || list[index - 1]! <= value)
  assert.equal(sorted, true)
})

test('BinarySearch reduceEvent advances algorithm and handles setTarget', () => {
  const state = BinarySearch.initState?.(8, 50) as unknown as BinarySearchStateLike
  const next = BinarySearch.reduceEvent?.(
    state as unknown as Record<string, unknown>,
    { type: 'nextStep' },
  ) as unknown as BinarySearchStateLike

  assert.equal(next.substep, 1)
  assert.equal(next.highlightedLines.has('line-1'), true)
  assert.match(next.currentStep ?? '', /Initialize: left/)

  const withTarget = BinarySearch.reduceEvent?.(
    next as unknown as Record<string, unknown>,
    { type: 'setTarget', payload: 77 },
  ) as unknown as BinarySearchStateLike

  assert.equal(withTarget.target, 77)
  assert.equal(withTarget.left, 0)
  assert.equal(withTarget.mid, null)
  assert.equal(withTarget.found, false)
})

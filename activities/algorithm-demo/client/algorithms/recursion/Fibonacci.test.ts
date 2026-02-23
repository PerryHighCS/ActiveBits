import test from 'node:test'
import assert from 'node:assert/strict'
import Fibonacci from './Fibonacci.js'

interface FibonacciStateLike {
  n: number
  callStack: Array<Record<string, unknown>>
  complete: boolean
  result: number | null
  substep: number
  highlightedLines: Set<string>
  overlays: Record<string, unknown>
  currentStep: string | null
}

void test('Fibonacci initState creates expected recursion state shell', () => {
  const state = Fibonacci.initState?.(6) as unknown as FibonacciStateLike

  assert.equal(state.n, 6)
  assert.deepEqual(state.callStack, [])
  assert.equal(state.complete, false)
  assert.equal(state.result, null)
  assert.equal(state.substep, 0)
  assert.equal(state.highlightedLines instanceof Set, true)
  assert.deepEqual(state.overlays, {})
  assert.equal(state.currentStep, null)
})

void test('Fibonacci reduceEvent advances first step and supports setN', () => {
  const state = Fibonacci.initState?.(6) as unknown as FibonacciStateLike
  const next = Fibonacci.reduceEvent?.(
    state as unknown as Record<string, unknown>,
    { type: 'nextStep' },
  ) as unknown as FibonacciStateLike

  assert.equal(next.callStack.length, 1)
  assert.equal(next.highlightedLines.has('line-0'), true)
  assert.match(next.currentStep ?? '', /Start: Fibonacci/)

  const updated = Fibonacci.reduceEvent?.(
    next as unknown as Record<string, unknown>,
    { type: 'setN', payload: 8 },
  ) as unknown as FibonacciStateLike

  assert.equal(updated.n, 8)
  assert.deepEqual(updated.callStack, [])
  assert.equal(updated.complete, false)
})

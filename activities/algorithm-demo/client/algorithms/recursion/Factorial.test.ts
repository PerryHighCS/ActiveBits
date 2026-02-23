import test from 'node:test'
import assert from 'node:assert/strict'
import Factorial from './Factorial.js'

interface FactorialStateLike {
  n: number
  callStack: Array<Record<string, unknown>>
  complete: boolean
  result: number | null
  substep: number
  highlightedLines: Set<string>
  overlays: Record<string, unknown>
  currentStep: string | null
}

void test('Factorial initState creates expected recursion state shell', () => {
  const state = Factorial.initState?.(5) as unknown as FactorialStateLike

  assert.equal(state.n, 5)
  assert.deepEqual(state.callStack, [])
  assert.equal(state.complete, false)
  assert.equal(state.result, null)
  assert.equal(state.substep, 0)
  assert.equal(state.highlightedLines instanceof Set, true)
  assert.deepEqual(state.overlays, {})
  assert.equal(state.currentStep, null)
})

void test('Factorial reduceEvent advances first step and supports reset', () => {
  const state = Factorial.initState?.(4) as unknown as FactorialStateLike
  const next = Factorial.reduceEvent?.(
    state as unknown as Record<string, unknown>,
    { type: 'nextStep' },
  ) as unknown as FactorialStateLike

  assert.equal(next.callStack.length, 1)
  assert.equal(next.highlightedLines.has('line-0'), true)
  assert.match(next.currentStep ?? '', /Start: Factorial/)

  const reset = Factorial.reduceEvent?.(
    {
      ...next,
      complete: true,
      result: 24,
    } as unknown as Record<string, unknown>,
    { type: 'reset' },
  ) as unknown as FactorialStateLike

  assert.equal(reset.n, 4)
  assert.deepEqual(reset.callStack, [])
  assert.equal(reset.complete, false)
  assert.equal(reset.result, null)
})

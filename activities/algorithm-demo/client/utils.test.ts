/**
 * Tests for algorithm-demo shared utilities
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MESSAGE_TYPES,
  createMessage,
  reduceAlgorithmEvent,
  validateLineIds,
  hydrateAlgorithmState,
  type ReducibleAlgorithmState,
} from './utils'

void test('MESSAGE_TYPES enum', () => {
  assert.equal(MESSAGE_TYPES.ALGORITHM_SELECTED, 'algorithm-selected')
  assert.equal(MESSAGE_TYPES.STATE_SYNC, 'state-sync')
  assert.equal(MESSAGE_TYPES.EVENT, 'event')
  assert.equal(MESSAGE_TYPES.POINTER, 'pointer')
})

void test('createMessage - builds valid envelope', () => {
  const msg = createMessage(MESSAGE_TYPES.STATE_SYNC, { count: 5 }, {
    algorithmId: 'test-algo',
    sessionId: 'session-123',
  })

  assert.equal(msg.type, MESSAGE_TYPES.STATE_SYNC)
  assert.deepEqual(msg.payload, { count: 5 })
  assert.equal(msg.algorithmId, 'test-algo')
  assert.equal(msg.sessionId, 'session-123')
  assert.ok(typeof msg.timestamp === 'number')
})

void test('createMessage - optional fields', () => {
  const msg = createMessage(MESSAGE_TYPES.POINTER, null)

  assert.equal(msg.type, MESSAGE_TYPES.POINTER)
  assert.equal(msg.payload, null)
  assert.ok(!('algorithmId' in msg))
  assert.ok(!('sessionId' in msg))
})

void test('validateLineIds - detects valid line references', () => {
  const pseudocode = ['Line 0', 'Line 1', 'Line 2']

  const valid = validateLineIds(pseudocode, ['line-0', 'line-2'])
  assert.deepEqual(valid, [])
})

void test('validateLineIds - detects invalid line references', () => {
  const pseudocode = ['Line 0', 'Line 1', 'Line 2']

  const invalid = validateLineIds(pseudocode, ['line-0', 'line-5', 'line-999'])
  assert.deepEqual(invalid, ['line-5', 'line-999'])
})

void test('reduceAlgorithmEvent - uses custom reducer if available', () => {
  const state: ReducibleAlgorithmState = {
    value: 10,
    reduceEvent: (currentState, event) => ({
      ...currentState,
      value: (currentState.value as number) + (event.payload as number),
    }),
  }

  const result = reduceAlgorithmEvent(state, { type: 'increment', payload: 5 })
  assert.equal(result.value as number, 15)
})

void test('reduceAlgorithmEvent - uses default reducer if no custom', () => {
  const state: ReducibleAlgorithmState = { value: 10 }
  const defaultReducer = (currentState: ReducibleAlgorithmState) => ({
    ...currentState,
    value: (currentState.value as number) * 2,
  })

  const result = reduceAlgorithmEvent(state, { type: 'noop' }, defaultReducer)
  assert.equal(result.value as number, 20)
})

void test('reduceAlgorithmEvent - returns unchanged state if no reducer', () => {
  const state = { value: 10 }
  const result = reduceAlgorithmEvent(state, { type: 'noop' })
  assert.deepEqual(result, state)
})

void test('hydrateAlgorithmState - returns state when algorithm is null/undefined', () => {
  const state = { foo: 'bar' }
  assert.deepEqual(hydrateAlgorithmState(null, state), state)
  assert.deepEqual(hydrateAlgorithmState(undefined, state), state)
})

void test('hydrateAlgorithmState - returns state when initState is not a function', () => {
  const state = { foo: 'bar' }
  const algorithm = { initState: 'nope' }
  assert.deepEqual(hydrateAlgorithmState(algorithm, state), state)
})

void test('hydrateAlgorithmState - handles null/undefined/array state', () => {
  const algorithm = { initState: () => ({ a: 1, b: 2 }) }
  assert.deepEqual(hydrateAlgorithmState(algorithm, null), { a: 1, b: 2 })
  assert.deepEqual(hydrateAlgorithmState(algorithm, undefined), { a: 1, b: 2 })
  assert.deepEqual(hydrateAlgorithmState(algorithm, [1, 2, 3]), { a: 1, b: 2 })
})

void test('hydrateAlgorithmState - merges baseState and state', () => {
  const algorithm = { initState: () => ({ a: 1, b: 2, c: 3 }) }
  const state = { b: 20, d: 4 }
  assert.deepEqual(hydrateAlgorithmState(algorithm, state), {
    a: 1,
    b: 20,
    c: 3,
    d: 4,
  })
})

void test('hydrateAlgorithmState - ignores null/undefined in state', () => {
  const algorithm = { initState: () => ({ a: 1, b: 2, c: 3 }) }
  const state = { a: null, b: undefined, c: 30 }
  assert.deepEqual(hydrateAlgorithmState(algorithm, state), {
    a: 1,
    b: 2,
    c: 30,
  })
})

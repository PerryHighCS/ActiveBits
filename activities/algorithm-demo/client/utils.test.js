/**
 * Tests for algorithm-demo shared utilities
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_TYPES,
  createMessage,
  reduceAlgorithmEvent,
  validateLineIds,
} from '../utils.js';

test('MESSAGE_TYPES enum', () => {
  assert.equal(MESSAGE_TYPES.ALGORITHM_SELECTED, 'algorithm-selected');
  assert.equal(MESSAGE_TYPES.STATE_SYNC, 'state-sync');
  assert.equal(MESSAGE_TYPES.EVENT, 'event');
  assert.equal(MESSAGE_TYPES.POINTER, 'pointer');
});

test('createMessage - builds valid envelope', () => {
  const msg = createMessage(MESSAGE_TYPES.STATE_SYNC, { count: 5 }, {
    algorithmId: 'test-algo',
    sessionId: 'session-123',
  });

  assert.equal(msg.type, MESSAGE_TYPES.STATE_SYNC);
  assert.deepEqual(msg.payload, { count: 5 });
  assert.equal(msg.algorithmId, 'test-algo');
  assert.equal(msg.sessionId, 'session-123');
  assert.ok(typeof msg.timestamp === 'number');
});

test('createMessage - optional fields', () => {
  const msg = createMessage(MESSAGE_TYPES.POINTER, null);
  
  assert.equal(msg.type, MESSAGE_TYPES.POINTER);
  assert.equal(msg.payload, null);
  assert.ok(!('algorithmId' in msg));
  assert.ok(!('sessionId' in msg));
});

test('validateLineIds - detects valid line references', () => {
  const pseudocode = [
    'Line 0',
    'Line 1',
    'Line 2',
  ];
  
  const valid = validateLineIds(pseudocode, ['line-0', 'line-2']);
  assert.deepEqual(valid, []);
});

test('validateLineIds - detects invalid line references', () => {
  const pseudocode = [
    'Line 0',
    'Line 1',
    'Line 2',
  ];
  
  const invalid = validateLineIds(pseudocode, ['line-0', 'line-5', 'line-999']);
  assert.deepEqual(invalid, ['line-5', 'line-999']);
});

test('reduceAlgorithmEvent - uses custom reducer if available', () => {
  const state = {
    value: 10,
    reduceEvent: (s, event) => ({ ...s, value: s.value + event.payload }),
  };
  
  const result = reduceAlgorithmEvent(state, { type: 'increment', payload: 5 });
  assert.equal(result.value, 15);
});

test('reduceAlgorithmEvent - uses default reducer if no custom', () => {
  const state = { value: 10 };
  const defaultReducer = (s, event) => ({ ...s, value: s.value * 2 });
  
  const result = reduceAlgorithmEvent(state, {}, defaultReducer);
  assert.equal(result.value, 20);
});

test('reduceAlgorithmEvent - returns unchanged state if no reducer', () => {
  const state = { value: 10 };
  const result = reduceAlgorithmEvent(state, {});
  assert.deepEqual(result, state);
});

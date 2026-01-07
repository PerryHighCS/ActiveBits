import test from 'node:test';
import assert from 'node:assert/strict';
import * as fractal from '../activities/triangulon-invasion/server/fractalStore.js';

const { FractalStore, getParentIndex, getChildrenIndices, getDepth } = fractal;

test('getParentIndex and getChildrenIndices reflect ternary heap', () => {
  assert.equal(getParentIndex(0), null);
  assert.equal(getParentIndex(1), 0);
  assert.equal(getParentIndex(3), 0);
  assert.equal(getParentIndex(4), 1);
  assert.deepEqual(getChildrenIndices(0), [1, 2, 3]);
  assert.deepEqual(getChildrenIndices(5), [16, 17, 18]);
});

test('getDepth closed form matches expected levels', () => {
  const cases = [
    [0, 0], // root
    [1, 1], [2, 1], [3, 1], // depth 1
    [4, 2], [12, 2], // depth 2 max index 12
    [13, 3], [39, 3], // depth 3 max index 39
    [40, 4],
  ];
  for (const [idx, expected] of cases) {
    assert.equal(getDepth(idx), expected);
  }
  assert.throws(() => getDepth(-1), /non-negative/);
});

test('FractalStore enforces parent presence and stores nodes', () => {
  const emptyStore = new FractalStore();
  assert.throws(() => emptyStore.addNode(1, { owner: 'orphan' }), /Parent must exist/);

  const store = new FractalStore();
  const root = store.addNode(0, { owner: 'alpha' });
  assert.equal(root.owner, 'alpha');
  assert(store.has(0));
  assert.equal(store.get(0).owner, 'alpha');
  const child = store.addNode(1, { owner: 'child' });
  assert.equal(child.owner, 'child');
  assert.deepEqual(store.getSiblings(1, { filterExisting: false }), [1, 2, 3]);
  assert.deepEqual(store.getSiblings(1), [1]);
});

test('FractalStore payload round-trip', () => {
  const store = new FractalStore();
  store.addNode(0, { owner: 'alpha', createdAt: 111, meta: { note: 'root' } });
  store.addNode(1, { owner: 'beta', createdAt: 222, meta: { note: 'left' } });
  const payload = store.toPayload();
  const restored = FractalStore.fromPayload(payload);
  assert.deepEqual(restored.get(0), { owner: 'alpha', createdAt: 111, meta: { note: 'root' } });
  assert.deepEqual(restored.get(1), { owner: 'beta', createdAt: 222, meta: { note: 'left' } });
});

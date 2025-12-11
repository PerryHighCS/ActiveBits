import test from 'node:test';
import assert from 'node:assert/strict';

const utilsUrl = new URL('../../../../../activities/gallery-walk/client/manager/feedbackUtils.js', import.meta.url);
const { sortFeedbackEntries } = await import(utilsUrl.href);

test('sortFeedbackEntries sorts by createdAt descending by default', () => {
  const entries = [
    { id: '1', createdAt: 10 },
    { id: '2', createdAt: 30 },
    { id: '3', createdAt: 20 },
  ];
  const sorted = sortFeedbackEntries(entries);
  assert.deepEqual(sorted.map((e) => e.id), ['2', '3', '1']);
});

test('sortFeedbackEntries handles ascending order and undefined values', () => {
  const entries = [
    { id: '1', createdAt: undefined },
    { id: '2', createdAt: 5 },
    { id: '3', createdAt: 1 },
  ];
  const sorted = sortFeedbackEntries(entries, 'createdAt', 'asc');
  assert.deepEqual(sorted.map((e) => e.id), ['1', '3', '2']);
});

test('sortFeedbackEntries works with alternate fields', () => {
  const entries = [
    { id: 'a', to: 'B' },
    { id: 'b', to: 'A' },
  ];
  const sorted = sortFeedbackEntries(entries, 'to', 'asc');
  assert.deepEqual(sorted.map((e) => e.id), ['b', 'a']);
});

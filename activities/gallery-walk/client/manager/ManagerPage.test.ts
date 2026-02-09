import test from 'node:test';
import assert from 'node:assert/strict';
import { sortFeedbackEntries, insertFeedbackEntry } from './feedbackUtils';
import { getTimestampMeta } from './managerUtils';

void test('sortFeedbackEntries sorts by createdAt descending by default', () => {
  const entries = [
    { id: '1', createdAt: 10 },
    { id: '2', createdAt: 30 },
    { id: '3', createdAt: 20 },
  ];
  const sorted = sortFeedbackEntries(entries);
  assert.deepEqual(sorted.map((e) => e.id), ['2', '3', '1']);
});

void test('sortFeedbackEntries handles ascending order and undefined values', () => {
  const entries = [
    { id: '1', createdAt: undefined },
    { id: '2', createdAt: 5 },
    { id: '3', createdAt: 1 },
  ];
  const sorted = sortFeedbackEntries(entries, 'createdAt', 'asc');
  assert.deepEqual(sorted.map((e) => e.id), ['1', '3', '2']);
});

void test('sortFeedbackEntries works with alternate fields', () => {
  const entries = [
    { id: 'a', to: 'B' },
    { id: 'b', to: 'A' },
  ];
  const sorted = sortFeedbackEntries(entries, 'to', 'asc');
  assert.deepEqual(sorted.map((e) => e.id), ['b', 'a']);
});

void test('insertFeedbackEntry replaces duplicate ids and prepends new entry', () => {
  const existing = [
    { id: '1', message: 'Old' },
    { id: '2', message: 'Another' },
  ];
  const next = { id: '1', message: 'Updated' };
  const result = insertFeedbackEntry(existing, next);
  assert.equal(result[0]?.message, 'Updated');
  assert.equal(result.length, 2);
});

void test('getTimestampMeta returns date and hides date for same day', () => {
  const now = new Date('2024-01-01T10:00:00Z');
  const sample = new Date('2024-01-01T14:00:00Z');
  const meta = getTimestampMeta(sample, now);
  assert.equal(meta.date?.toISOString(), sample.toISOString());
  assert.equal(meta.showDateOnScreen, false);
});

void test('getTimestampMeta shows date if different day', () => {
  const now = new Date('2024-01-02T10:00:00Z');
  const sample = new Date('2024-01-01T14:00:00Z');
  const meta = getTimestampMeta(sample, now);
  assert.equal(meta.showDateOnScreen, true);
});

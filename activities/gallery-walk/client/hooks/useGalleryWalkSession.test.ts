import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGalleryWalkWsUrl,
  parseGalleryWalkSocketMessage,
  getMessageStage,
  getMessageReviewees,
  getMessageFeedbackEntry,
  insertOrReplaceFeedbackEntry,
  type GalleryWalkFeedbackEntry,
} from './useGalleryWalkSession';

test('buildGalleryWalkWsUrl derives protocol from location', () => {
  const secure = buildGalleryWalkWsUrl('abc123', { protocol: 'https:', host: 'example.com' });
  const insecure = buildGalleryWalkWsUrl('abc123', { protocol: 'http:', host: 'localhost:3000' });

  assert.equal(secure, 'wss://example.com/ws/gallery-walk?sessionId=abc123');
  assert.equal(insecure, 'ws://localhost:3000/ws/gallery-walk?sessionId=abc123');
  assert.equal(buildGalleryWalkWsUrl(null, { protocol: 'https:', host: 'example.com' }), null);
});

test('parseGalleryWalkSocketMessage parses valid JSON objects only', () => {
  const parsed = parseGalleryWalkSocketMessage('{"type":"stage-changed","payload":{"stage":"review"}}');

  assert.equal(parsed?.type, 'stage-changed');
  assert.equal(getMessageStage(parsed ?? {}), 'review');
  assert.equal(parseGalleryWalkSocketMessage('not json'), null);
  assert.equal(parseGalleryWalkSocketMessage('"string"'), null);
});

test('message helpers safely normalize reviewees and feedback entries', () => {
  const revieweesMessage = parseGalleryWalkSocketMessage(
    '{"type":"reviewees-updated","payload":{"reviewees":{"R1":{"name":"Ada"}}}}',
  );
  const emptyRevieweesMessage = parseGalleryWalkSocketMessage(
    '{"type":"reviewees-updated","payload":{"reviewees":null}}',
  );

  assert.deepEqual(getMessageReviewees(revieweesMessage ?? {}), { R1: { name: 'Ada' } });
  assert.deepEqual(getMessageReviewees(emptyRevieweesMessage ?? {}), {});

  const entryMessage = parseGalleryWalkSocketMessage(
    '{"type":"feedback-added","payload":{"feedback":{"id":"1","message":"Nice work"}}}',
  );
  const entry = getMessageFeedbackEntry(entryMessage ?? {});

  assert.equal(entry?.id, '1');
  assert.equal(getMessageFeedbackEntry({ type: 'feedback-added', payload: { feedback: 'invalid' } }), null);
});

test('insertOrReplaceFeedbackEntry prepends and deduplicates by id', () => {
  const existing: GalleryWalkFeedbackEntry[] = [
    { id: '1', message: 'old' },
    { id: '2', message: 'two' },
  ];

  const updated = insertOrReplaceFeedbackEntry(existing, { id: '1', message: 'new' });

  assert.deepEqual(updated.map((item) => item.id), ['1', '2']);
  assert.equal(updated[0]?.message, 'new');
});

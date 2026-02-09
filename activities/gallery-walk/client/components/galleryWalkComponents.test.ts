import test from 'node:test';
import assert from 'node:assert/strict';

import FeedbackCards, { buildFeedbackCardKeys } from './FeedbackCards.js';
import FeedbackView from './FeedbackView.js';
import FeedbackViewSwitcher from './FeedbackViewSwitcher.js';
import GalleryWalkFeedbackTable, { buildFeedbackRowKeys } from './GalleryWalkFeedbackTable.js';
import LocalReviewerForm from './LocalReviewerForm.js';
import NoteStyleSelect from './NoteStyleSelect.js';
import ProjectStationCard from './ProjectStationCard.js';
import RegistrationForm from './RegistrationForm.js';
import ReviewerFeedbackForm from './ReviewerFeedbackForm.js';
import ReviewerIdentityForm from './ReviewerIdentityForm.js';
import ReviewerPanel from './ReviewerPanel.js';
import ReviewerScanner from './ReviewerScanner.js';
import StageControls from './StageControls.js';
import TitleEditor from './TitleEditor.js';

void test('gallery-walk converted components export callable React components', () => {
  const components = [
    FeedbackCards,
    FeedbackView,
    FeedbackViewSwitcher,
    GalleryWalkFeedbackTable,
    LocalReviewerForm,
    NoteStyleSelect,
    ProjectStationCard,
    RegistrationForm,
    ReviewerFeedbackForm,
    ReviewerIdentityForm,
    ReviewerPanel,
    ReviewerScanner,
    StageControls,
    TitleEditor,
  ];

  for (const component of components) {
    assert.equal(typeof component, 'function');
  }
});

void test('buildFeedbackRowKeys prefers id and uses stable field-derived fallback keys', () => {
  const longMessage = 'Nice work '.repeat(50);
  const baselineKeys = buildFeedbackRowKeys([
    { id: 'feedback-1', message: 'Great structure' },
    { to: 'student-a', from: 'reviewer-a', fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: longMessage },
  ]);

  assert.equal(baselineKeys[0], 'id:feedback-1');
  assert.match(baselineKeys[1] ?? '', /^entry:student-a\|reviewer-a\|1700000000000\|[a-z0-9]+$/);
  assert.ok(!(baselineKeys[1] ?? '').includes(longMessage));

  const withInsertedEntry = buildFeedbackRowKeys([
    { to: 'student-b', from: 'reviewer-b', createdAt: 1700000001000, message: 'Inserted row' },
    { id: 'feedback-1', message: 'Great structure' },
    { to: 'student-a', from: 'reviewer-a', fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: longMessage },
  ]);

  assert.equal(withInsertedEntry[1], 'id:feedback-1');
  assert.equal(withInsertedEntry[2], baselineKeys[1]);
});

void test('buildFeedbackRowKeys disambiguates duplicate fallback keys deterministically', () => {
  const duplicateEntries = [
    { to: 'student-a', from: 'reviewer-a', createdAt: 1700000000000, message: 'Same note' },
    { to: 'student-a', from: 'reviewer-a', createdAt: 1700000000000, message: 'Same note' },
  ];

  const keys = buildFeedbackRowKeys(duplicateEntries);
  assert.match(keys[0] ?? '', /^entry:student-a\|reviewer-a\|1700000000000\|[a-z0-9]+$/);
  assert.equal(keys[1], `${keys[0]}#2`);
});

void test('buildFeedbackCardKeys prefers id and uses stable field-derived fallback keys', () => {
  const longMessage = 'Excellent work '.repeat(50);
  const baselineKeys = buildFeedbackCardKeys([
    { id: 'card-1', message: 'Great job' },
    { fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: longMessage },
  ]);

  assert.equal(baselineKeys[0], 'id:card-1');
  assert.match(baselineKeys[1] ?? '', /^card:Alex\|1700000000000\|[a-z0-9]+$/);
  assert.ok(!(baselineKeys[1] ?? '').includes(longMessage));

  const withInsertedEntry = buildFeedbackCardKeys([
    { fromNameSnapshot: 'Sam', createdAt: 1700000001000, message: 'Inserted card' },
    { id: 'card-1', message: 'Great job' },
    { fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: longMessage },
  ]);

  assert.equal(withInsertedEntry[1], 'id:card-1');
  assert.equal(withInsertedEntry[2], baselineKeys[1]);
});

void test('buildFeedbackCardKeys disambiguates duplicate fallback keys deterministically', () => {
  const duplicateEntries = [
    { fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: 'Same feedback' },
    { fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: 'Same feedback' },
  ];

  const keys = buildFeedbackCardKeys(duplicateEntries);
  assert.match(keys[0] ?? '', /^card:Alex\|1700000000000\|[a-z0-9]+$/);
  assert.equal(keys[1], `${keys[0]}#2`);
});

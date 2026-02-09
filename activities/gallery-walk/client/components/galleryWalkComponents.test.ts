import test from 'node:test';
import assert from 'node:assert/strict';

import FeedbackCards from './FeedbackCards';
import FeedbackView from './FeedbackView';
import FeedbackViewSwitcher from './FeedbackViewSwitcher';
import GalleryWalkFeedbackTable, { buildFeedbackRowKeys } from './GalleryWalkFeedbackTable';
import LocalReviewerForm from './LocalReviewerForm';
import NoteStyleSelect from './NoteStyleSelect';
import ProjectStationCard from './ProjectStationCard';
import RegistrationForm from './RegistrationForm';
import ReviewerFeedbackForm from './ReviewerFeedbackForm';
import ReviewerIdentityForm from './ReviewerIdentityForm';
import ReviewerPanel from './ReviewerPanel';
import ReviewerScanner from './ReviewerScanner';
import StageControls from './StageControls';
import TitleEditor from './TitleEditor';

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
  const baselineKeys = buildFeedbackRowKeys([
    { id: 'feedback-1', message: 'Great structure' },
    { to: 'student-a', from: 'reviewer-a', fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: 'Nice work' },
  ]);

  assert.deepEqual(baselineKeys, [
    'id:feedback-1',
    'entry:student-a|reviewer-a|Alex|1700000000000|Nice work',
  ]);

  const withInsertedEntry = buildFeedbackRowKeys([
    { to: 'student-b', from: 'reviewer-b', createdAt: 1700000001000, message: 'Inserted row' },
    { id: 'feedback-1', message: 'Great structure' },
    { to: 'student-a', from: 'reviewer-a', fromNameSnapshot: 'Alex', createdAt: 1700000000000, message: 'Nice work' },
  ]);

  assert.equal(withInsertedEntry[1], 'id:feedback-1');
  assert.equal(withInsertedEntry[2], 'entry:student-a|reviewer-a|Alex|1700000000000|Nice work');
});

void test('buildFeedbackRowKeys disambiguates duplicate fallback keys deterministically', () => {
  const duplicateEntries = [
    { to: 'student-a', from: 'reviewer-a', createdAt: 1700000000000, message: 'Same note' },
    { to: 'student-a', from: 'reviewer-a', createdAt: 1700000000000, message: 'Same note' },
  ];

  const keys = buildFeedbackRowKeys(duplicateEntries);
  assert.deepEqual(keys, [
    'entry:student-a|reviewer-a||1700000000000|Same note',
    'entry:student-a|reviewer-a||1700000000000|Same note#2',
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import FeedbackCards from './FeedbackCards';
import FeedbackView from './FeedbackView';
import FeedbackViewSwitcher from './FeedbackViewSwitcher';
import GalleryWalkFeedbackTable from './GalleryWalkFeedbackTable';
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

test('gallery-walk converted components export callable React components', () => {
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

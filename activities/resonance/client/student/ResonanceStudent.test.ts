import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNextSelfPacedQuestionId } from './ResonanceStudent.js'
import { clearLiveQuestionSubmission, resolveQuestionAnswer } from './ResonanceStudent.js'
import { resolveQuestionStatusBadge } from './ResonanceStudent.js'
import { resolveSubmissionAnnouncement } from './ResonanceStudent.js'
import { resolveSelfPacedSubmittedMessage } from './ResonanceStudent.js'
import { hasActiveQuestionRunRestart } from './ResonanceStudent.js'
import { shouldRetryRegistrationWithoutStudentId } from './ResonanceStudent.js'
import { advanceEditSequenceForRevisit, resolveCurrentEditSequence } from './ResonanceStudent.js'
import { seedEditSequenceFromConfirmedResponse } from './ResonanceStudent.js'
import { buildUnconfirmedDraftKey } from './ResonanceStudent.js'
import { resolveUnconfirmedDraftDisposition } from './ResonanceStudent.js'

void test('unconfirmed draft keys keep a stack-tab draft scoped to its live run', () => {
  const answer = { type: 'free-response', text: 'Saved after switching tabs' }
  assert.equal(
    buildUnconfirmedDraftKey({ questionId: 'q1', activeQuestionRunRevision: 7, answer }),
    'q1:7',
  )
  assert.equal(
    buildUnconfirmedDraftKey({ questionId: 'q1', activeQuestionRunStartedAt: 123, answer }),
    'q1:123',
  )
  assert.equal(buildUnconfirmedDraftKey({ questionId: 'q1', answer }), null)
})

void test('unconfirmed draft retry stops on deadline or an authoritative run change', () => {
  const payload = {
    studentId: 'student-1',
    questionId: 'q1',
    activeQuestionRunRevision: 7,
    answer: { type: 'free-response', text: 'Keep this draft' },
  }
  const snapshot = {
    activeQuestionIds: ['q1', 'q2'],
    activeQuestionRunStartedAt: 1_000,
    activeQuestionRunRevision: 7,
    activeQuestionDeadlineAt: 2_000,
  }

  assert.equal(resolveUnconfirmedDraftDisposition(payload, snapshot, 'student-1', 1_999), 'retry')
  assert.equal(resolveUnconfirmedDraftDisposition(payload, snapshot, 'student-1', 2_000), 'reconcile')
  assert.equal(
    resolveUnconfirmedDraftDisposition(payload, { ...snapshot, activeQuestionRunRevision: 8 }, 'student-1', 1_999),
    'discard',
  )
  assert.equal(
    resolveUnconfirmedDraftDisposition(payload, { ...snapshot, activeQuestionIds: ['q2'] }, 'student-1', 1_999),
    'discard',
  )
})

void test('registration retries without a stale restored student id after authorization is lost', () => {
  assert.equal(shouldRetryRegistrationWithoutStudentId(403, 'student-1'), true)
  assert.equal(shouldRetryRegistrationWithoutStudentId(403, null), false)
  assert.equal(shouldRetryRegistrationWithoutStudentId(429, 'student-1'), false)
})

void test('clearLiveQuestionSubmission unlocks a revisited live question only', () => {
  const submittedQuestionIds = new Set(['q1', 'q2'])

  assert.deepEqual(
    clearLiveQuestionSubmission({
      selfPacedMode: false,
      submittedQuestionIds,
      questionId: 'q1',
    }),
    new Set(['q2']),
  )
  assert.equal(
    clearLiveQuestionSubmission({
      selfPacedMode: true,
      submittedQuestionIds,
      questionId: 'q1',
    }),
    submittedQuestionIds,
  )
})

void test('edit-sequence bookkeeping survives a QuestionView remount, unlike a component-local counter', () => {
  // QuestionView is keyed by question id, so switching stack tabs away and
  // back remounts it with a fresh local ref if it owned this counter itself.
  // ResonanceStudent owns it instead, so a revisit still advances the
  // sequence past whatever the confirmed response recorded.
  let byKey: Record<string, number> = {}
  assert.equal(resolveCurrentEditSequence(byKey, 'q1', 1), 1)

  byKey = advanceEditSequenceForRevisit(byKey, 'q1', 1)
  assert.equal(resolveCurrentEditSequence(byKey, 'q1', 1), 2)

  // A second revisit (e.g. switching away and back again) advances further.
  byKey = advanceEditSequenceForRevisit(byKey, 'q1', 1)
  assert.equal(resolveCurrentEditSequence(byKey, 'q1', 1), 3)

  // A different question, or the same question in a new run, is independent.
  assert.equal(resolveCurrentEditSequence(byKey, 'q2', 1), 1)
  assert.equal(resolveCurrentEditSequence(byKey, 'q1', 2), 1)
})

void test('seedEditSequenceFromConfirmedResponse recovers a post-reload counter from the server, instead of defaulting to 1 and colliding with an existing submission', () => {
  // Without this seed, a page reload mid-run leaves editSequenceByKeyRef empty
  // (it's only ever bumped in memory by a revisit click). resolveCurrentEditSequence
  // would then default the next autosave to sequence 1 — but the confirmed
  // response from *before* the reload is already at sequence 1, so the
  // server's stale-draft guard (editSequence <= confirmed.editSequence) would
  // silently drop the reloaded student's revision.
  let byKey: Record<string, number> = {}
  byKey = seedEditSequenceFromConfirmedResponse(byKey, 'q1', 1, 1)
  assert.equal(resolveCurrentEditSequence(byKey, 'q1', 1), 2)

  // A higher confirmed sequence (the student had already revisited before
  // reloading) seeds a correspondingly higher floor.
  byKey = seedEditSequenceFromConfirmedResponse(byKey, 'q2', 1, 3)
  assert.equal(resolveCurrentEditSequence(byKey, 'q2', 1), 4)

  // Seeding never lowers a counter already advanced further locally this
  // session (e.g. a revisit click already happened before the next snapshot
  // arrived and re-seeds from the same confirmed value).
  byKey = advanceEditSequenceForRevisit(byKey, 'q2', 1)
  assert.equal(resolveCurrentEditSequence(byKey, 'q2', 1), 5)
  byKey = seedEditSequenceFromConfirmedResponse(byKey, 'q2', 1, 3)
  assert.equal(resolveCurrentEditSequence(byKey, 'q2', 1), 5)

  // A different run token is an independent counter, unaffected by seeding.
  assert.equal(resolveCurrentEditSequence(byKey, 'q1', 2), 1)
})

void test('resolveQuestionAnswer preserves a revised local draft over an older snapshot answer', () => {
  assert.deepEqual(
    resolveQuestionAnswer({
      localAnswers: {
        q1: { type: 'free-response', text: 'Revised answer' },
      },
      snapshotAnswers: {
        q1: { type: 'free-response', text: 'Previously submitted answer' },
      },
      questionId: 'q1',
    }),
    { type: 'free-response', text: 'Revised answer' },
  )
})

void test('resolveQuestionAnswer preserves an intentionally cleared local draft', () => {
  assert.equal(
    resolveQuestionAnswer({
      localAnswers: { q1: null },
      snapshotAnswers: {
        q1: { type: 'free-response', text: 'Previously submitted answer' },
      },
      questionId: 'q1',
    }),
    null,
  )
})

void test('resolveNextSelfPacedQuestionId advances to the next unanswered question', () => {
  assert.equal(
    resolveNextSelfPacedQuestionId({
      questionIds: ['q1', 'q2', 'q3'],
      submittedQuestionIds: new Set(['q1']),
      currentQuestionId: 'q1',
    }),
    'q2',
  )
})

void test('resolveNextSelfPacedQuestionId continues forward to the next unanswered question after the current index', () => {
  assert.equal(
    resolveNextSelfPacedQuestionId({
      questionIds: ['q1', 'q2', 'q3'],
      submittedQuestionIds: new Set(['q2']),
      currentQuestionId: 'q2',
    }),
    'q3',
  )
})

void test('resolveNextSelfPacedQuestionId keeps the current question when all are submitted', () => {
  assert.equal(
    resolveNextSelfPacedQuestionId({
      questionIds: ['q1', 'q2'],
      submittedQuestionIds: new Set(['q1', 'q2']),
      currentQuestionId: 'q2',
    }),
    'q2',
  )
})

void test('resolveNextSelfPacedQuestionId falls back to a valid question id when the current id is stale', () => {
  assert.equal(
    resolveNextSelfPacedQuestionId({
      questionIds: ['q1', 'q2'],
      submittedQuestionIds: new Set(['q1', 'q2']),
      currentQuestionId: 'q9',
    }),
    'q1',
  )
})

void test('resolveSelfPacedSubmittedMessage announces forward progression when another unanswered question remains', () => {
  assert.equal(
    resolveSelfPacedSubmittedMessage({
      questionIds: ['q1', 'q2', 'q3'],
      submittedQuestionIds: new Set(['q1']),
      currentQuestionId: 'q1',
    }),
    'Answer submitted. Moving to the next question.',
  )
})

void test('resolveSelfPacedSubmittedMessage announces completion when all questions are submitted', () => {
  assert.equal(
    resolveSelfPacedSubmittedMessage({
      questionIds: ['q1', 'q2'],
      submittedQuestionIds: new Set(['q1', 'q2']),
      currentQuestionId: 'q2',
    }),
    'All questions completed.',
  )
})

void test('resolveSubmissionAnnouncement uses the self-paced message when self-paced mode is active', () => {
  assert.equal(
    resolveSubmissionAnnouncement({
      selfPacedMode: true,
      questionIds: ['q1', 'q2'],
      submittedQuestionIds: new Set(['q1']),
      currentQuestionId: 'q1',
    }),
    'Answer submitted. Moving to the next question.',
  )
})

void test('resolveSubmissionAnnouncement returns null outside self-paced mode', () => {
  assert.equal(
    resolveSubmissionAnnouncement({
      selfPacedMode: false,
      questionIds: ['q1', 'q2'],
      submittedQuestionIds: new Set(['q1']),
      currentQuestionId: 'q1',
    }),
    null,
  )
})

void test('resolveQuestionStatusBadge avoids live copy for self-paced questions', () => {
  const selfPacedBadge = resolveQuestionStatusBadge(true)
  assert.equal(selfPacedBadge.label, 'Self-paced')
  assert.doesNotMatch(selfPacedBadge.dotClassName, /animate-pulse/)

  const liveBadge = resolveQuestionStatusBadge(false)
  assert.equal(liveBadge.label, 'Live Question')
  assert.match(liveBadge.dotClassName, /animate-pulse/)
  assert.match(liveBadge.dotClassName, /motion-reduce:animate-none/)
})

void test('hasActiveQuestionRunRestart ignores the initial live snapshot but detects a later idle-to-live transition', () => {
  assert.equal(
    hasActiveQuestionRunRestart({
      hasObservedSnapshot: false,
      activeQuestionIds: ['q1'],
      activeQuestionRunRevision: 1,
      previousActiveQuestionRunRevision: null,
      activeQuestionRunStartedAt: 2_000,
      previousActiveQuestionRunStartedAt: null,
    }),
    false,
  )
  assert.equal(
    hasActiveQuestionRunRestart({
      hasObservedSnapshot: true,
      activeQuestionIds: ['q1'],
      activeQuestionRunRevision: 1,
      previousActiveQuestionRunRevision: null,
      activeQuestionRunStartedAt: 2_000,
      previousActiveQuestionRunStartedAt: null,
    }),
    true,
  )
})

void test('hasActiveQuestionRunRestart detects a new revision when activation timestamps match', () => {
  assert.equal(
    hasActiveQuestionRunRestart({
      hasObservedSnapshot: true,
      activeQuestionIds: ['q1'],
      activeQuestionRunRevision: 2,
      previousActiveQuestionRunRevision: 1,
      activeQuestionRunStartedAt: 2_000,
      previousActiveQuestionRunStartedAt: 2_000,
    }),
    true,
  )
})

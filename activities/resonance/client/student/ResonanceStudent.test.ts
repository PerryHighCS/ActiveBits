import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { resolveNextSelfPacedQuestionId } from './ResonanceStudent.js'
import { clearLiveQuestionSubmission, resolveQuestionAnswer } from './ResonanceStudent.js'
import { resolveQuestionStatusBadge } from './ResonanceStudent.js'
import { resolveSubmissionAnnouncement } from './ResonanceStudent.js'
import { resolveSelfPacedSubmittedMessage } from './ResonanceStudent.js'
import { hasActiveQuestionRunRestart } from './ResonanceStudent.js'
import { shouldRetryRegistrationWithoutStudentId } from './ResonanceStudent.js'
import { advanceEditSequenceForRevisit, resolveCurrentEditSequence } from './ResonanceStudent.js'
import { seedEditSequenceFromConfirmedResponse } from './ResonanceStudent.js'
import { selectUnconfirmedDraftQuestionIds, resetAnswersForRestartedQuestions } from './ResonanceStudent.js'
import { clearDraftTracking, isDraftStillCurrentForRevision } from './ResonanceStudent.js'
import type { AnswerPayload, StudentSessionSnapshot } from '../../shared/types.js'

;(globalThis as { React?: typeof React }).React = React

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code?: number }) => void) | null = null
  readyState = 1
  sent: unknown[] = []

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(message: string): void {
    this.sent.push(JSON.parse(message))
  }

  close(): void {
    this.readyState = 3
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

function buildSnapshot(overrides: Partial<StudentSessionSnapshot> = {}): StudentSessionSnapshot {
  return {
    sessionId: 'session-1',
    selfPacedMode: false,
    presentationMode: 'standard',
    stagedRun: null,
    activeQuestion: null,
    activeQuestions: [],
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    activeQuestionDeadlineAt: null,
    lastActiveQuestionRunRevision: null,
    reveals: [],
    reviewedResponses: [],
    submittedAnswers: {},
    draftAnswers: {},
    draftSendSequences: {},
    draftEditSequences: {},
    submittedResponseEditSequences: {},
    revealedQuestions: [],
    ...overrides,
  }
}

function installResonanceStudentTestEnvironment(): () => void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/s1',
  })

  const keys = ['window', 'document', 'navigator', 'WebSocket', 'fetch', 'localStorage', 'sessionStorage'] as const
  const descriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of keys) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: dom.window.sessionStorage })

  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, key)
      }
    }
    dom.window.close()
    FakeWebSocket.instances.length = 0
  }
}

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
    }),
    false,
  )
  assert.equal(
    hasActiveQuestionRunRestart({
      hasObservedSnapshot: true,
      activeQuestionIds: ['q1'],
      activeQuestionRunRevision: 1,
      previousActiveQuestionRunRevision: null,
    }),
    true,
  )
})

void test('hasActiveQuestionRunRestart detects a new revision', () => {
  assert.equal(
    hasActiveQuestionRunRestart({
      hasObservedSnapshot: true,
      activeQuestionIds: ['q1'],
      activeQuestionRunRevision: 2,
      previousActiveQuestionRunRevision: 1,
    }),
    true,
  )
})

void test('selectUnconfirmedDraftQuestionIds retries an unconfirmed question but not a submitted or already-confirmed one', () => {
  assert.deepEqual(
    selectUnconfirmedDraftQuestionIds({
      activeQuestionIds: ['q1', 'q2', 'q3'],
      submittedQuestionIds: new Set(['q2']),
      unconfirmedQuestionIds: new Set(['q1', 'q2']),
    }),
    ['q1'],
  )
  assert.deepEqual(
    selectUnconfirmedDraftQuestionIds({
      activeQuestionIds: ['q1'],
      submittedQuestionIds: new Set(),
      unconfirmedQuestionIds: new Set(),
    }),
    [],
  )
})

void test('resetAnswersForRestartedQuestions drops a restarted question’s cached answer, leaving others untouched', () => {
  const submittedAnswers: Record<string, AnswerPayload | null> = {
    q1: { type: 'free-response', text: 'Stale answer from the previous run' },
    q2: { type: 'free-response', text: 'Unaffected answer' },
  }
  assert.deepEqual(
    resetAnswersForRestartedQuestions({ submittedAnswers, questionIdsToReset: ['q1'] }),
    { q2: { type: 'free-response', text: 'Unaffected answer' } },
  )
  assert.equal(
    resetAnswersForRestartedQuestions({ submittedAnswers, questionIdsToReset: [] }),
    submittedAnswers,
  )
})

void test('clearDraftTracking clears both unconfirmed and in-flight markers together, leaving other questions untouched', () => {
  // Decision table: {present in unconfirmed} x {present in in-flight} x
  // {named in questionIds}. This pairing exists because attemptDraftSend's
  // in-flight guard would otherwise silently block a fresh attempt for a
  // question whose prior attempt was abandoned for a reason other than its
  // own acknowledgement (submission, run restart, deadline reconciliation).
  const cases: Array<{
    name: string
    unconfirmed: string[]
    inFlight: string[]
    dirtyRevisions: string[]
    pendingRetry: string[]
    questionIds: string[]
    expectedUnconfirmed: string[]
    expectedInFlight: string[]
    expectedDirtyRevisions: string[]
    expectedPendingRetry: string[]
  }> = [
    {
      name: 'in all four and named: cleared from all four',
      unconfirmed: ['q1'],
      inFlight: ['q1'],
      dirtyRevisions: ['q1'],
      pendingRetry: ['q1'],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
      expectedDirtyRevisions: [],
      expectedPendingRetry: [],
    },
    {
      name: 'unconfirmed only (no attempt ever started): still safe to clear',
      unconfirmed: ['q1'],
      inFlight: [],
      dirtyRevisions: ['q1'],
      pendingRetry: [],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
      expectedDirtyRevisions: [],
      expectedPendingRetry: [],
    },
    {
      name: 'in-flight only (already confirmed, still awaiting ack): still safe to clear',
      unconfirmed: [],
      inFlight: ['q1'],
      dirtyRevisions: [],
      pendingRetry: [],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
      expectedDirtyRevisions: [],
      expectedPendingRetry: [],
    },
    {
      name: 'pending retry only (a newer edit was requested while the prior attempt was in flight, then abandoned): still safe to clear',
      unconfirmed: [],
      inFlight: [],
      dirtyRevisions: [],
      pendingRetry: ['q1'],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
      expectedDirtyRevisions: [],
      expectedPendingRetry: [],
    },
    {
      name: 'present in all four but not named: left untouched',
      unconfirmed: ['q1', 'q2'],
      inFlight: ['q1', 'q2'],
      dirtyRevisions: ['q1', 'q2'],
      pendingRetry: ['q1', 'q2'],
      questionIds: ['q2'],
      expectedUnconfirmed: ['q1'],
      expectedInFlight: ['q1'],
      expectedDirtyRevisions: ['q1'],
      expectedPendingRetry: ['q1'],
    },
    {
      name: 'named but absent from all four: no-op, no error',
      unconfirmed: [],
      inFlight: [],
      dirtyRevisions: [],
      pendingRetry: [],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
      expectedDirtyRevisions: [],
      expectedPendingRetry: [],
    },
    {
      name: 'empty questionIds: no-op even when all four are populated',
      unconfirmed: ['q1'],
      inFlight: ['q1'],
      dirtyRevisions: ['q1'],
      pendingRetry: ['q1'],
      questionIds: [],
      expectedUnconfirmed: ['q1'],
      expectedInFlight: ['q1'],
      expectedDirtyRevisions: ['q1'],
      expectedPendingRetry: ['q1'],
    },
  ]

  for (const testCase of cases) {
    const unconfirmedQuestionIds = new Set(testCase.unconfirmed)
    const inFlightDraftQuestionIds = new Map(testCase.inFlight.map((questionId) => [questionId, 1]))
    const unconfirmedQuestionRunRevisions = new Map(testCase.dirtyRevisions.map((questionId) => [questionId, 1]))
    const pendingRetryAfterInFlightQuestionIds = new Set(testCase.pendingRetry)
    clearDraftTracking({
      unconfirmedQuestionIds,
      inFlightDraftQuestionIds,
      unconfirmedQuestionRunRevisions,
      pendingRetryAfterInFlightQuestionIds,
      questionIds: testCase.questionIds,
    })
    assert.deepEqual(
      [...unconfirmedQuestionIds].sort(),
      [...testCase.expectedUnconfirmed].sort(),
      `${testCase.name}: unconfirmed`,
    )
    assert.deepEqual(
      [...inFlightDraftQuestionIds.keys()].sort(),
      [...testCase.expectedInFlight].sort(),
      `${testCase.name}: in-flight`,
    )
    assert.deepEqual(
      [...unconfirmedQuestionRunRevisions.keys()].sort(),
      [...testCase.expectedDirtyRevisions].sort(),
      `${testCase.name}: dirty revisions`,
    )
    assert.deepEqual(
      [...pendingRetryAfterInFlightQuestionIds].sort(),
      [...testCase.expectedPendingRetry].sort(),
      `${testCase.name}: pending retry`,
    )
  }
})

void test('isDraftStillCurrentForRevision rejects a question whose dirty revision no longer matches the current one', () => {
  // Copilot review of PR #381: a run transition's own cleanup runs in a
  // passive effect, scheduled after the render that already updated the
  // current snapshot — an already-due debounce/retry timer can fire in that
  // window, before cleanup removes the question from unconfirmedQuestionIds.
  // attemptDraftSend's existing set-membership guard can't see that window
  // (the question is still nominally "unconfirmed" there); this check closes
  // it by comparing against the revision the question actually became dirty
  // under, independent of whether cleanup has run yet. Decision table:
  // {tracked at all} x {matching current revision} x {revision is null vs a
  // number}, since null (self-paced/idle) and a real number must not be
  // treated as interchangeable.
  const cases: Array<{
    name: string
    dirtyRevisions: Array<[string, number | null]>
    questionId: string
    currentRunRevision: number | null
    expected: boolean
  }> = [
    {
      name: 'dirtied under the revision that is still current: still safe to send',
      dirtyRevisions: [['q1', 3]],
      questionId: 'q1',
      currentRunRevision: 3,
      expected: true,
    },
    {
      name: 'dirtied under a revision the run has since moved past: must not send',
      dirtyRevisions: [['q1', 3]],
      questionId: 'q1',
      currentRunRevision: 4,
      expected: false,
    },
    {
      name: 'dirtied while live, run has since ended into self-paced/idle (null): must not send',
      dirtyRevisions: [['q1', 3]],
      questionId: 'q1',
      currentRunRevision: null,
      expected: false,
    },
    {
      name: 'dirtied while self-paced/idle (null), a live run has since started: must not send',
      dirtyRevisions: [['q1', null]],
      questionId: 'q1',
      currentRunRevision: 1,
      expected: false,
    },
    {
      name: 'dirtied and still self-paced/idle (null both times): still safe to send',
      dirtyRevisions: [['q1', null]],
      questionId: 'q1',
      currentRunRevision: null,
      expected: true,
    },
    {
      name: 'never recorded as dirty at all: must not send (nothing to reconstruct the true context from)',
      dirtyRevisions: [],
      questionId: 'q1',
      currentRunRevision: 1,
      expected: false,
    },
    {
      name: 'a different question’s dirty revision does not leak into this one’s check',
      dirtyRevisions: [['q2', 1]],
      questionId: 'q1',
      currentRunRevision: 1,
      expected: false,
    },
  ]

  for (const testCase of cases) {
    const unconfirmedQuestionRunRevisions = new Map(testCase.dirtyRevisions)
    assert.equal(
      isDraftStillCurrentForRevision({
        unconfirmedQuestionRunRevisions,
        questionId: testCase.questionId,
        currentRunRevision: testCase.currentRunRevision,
      }),
      testCase.expected,
      testCase.name,
    )
  }
})

void test('a stale settlement from an abandoned attempt does not let a newer attempt for the same question be duplicated', async () => {
  // Regression test (Copilot review of PR #381): attemptDraftSend's ack
  // continuation used to delete inFlightDraftQuestionIdsRef unconditionally
  // on settlement. If an attempt is abandoned (clearDraftTracking, e.g. a run
  // restart) while its saveDraft() promise is still outstanding, and a fresh
  // attempt starts for the same question before that old promise settles,
  // the old attempt's later settlement would wrongly clear the new attempt's
  // in-flight marker — letting the retry loop fire a third, duplicate send
  // for the same question while the second attempt was still genuinely
  // outstanding (not yet acked or timed out).
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never auto-ack — attempt A is left permanently unsettled until we
    // deliver its stale ack by hand, below.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    type DraftMessage = { type: string; payload: { questionId?: string; activeQuestionRunRevision?: number | null; draftId?: string } }
    const isQ1Draft = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null &&
      (message as { type?: string }).type === 'resonance:update-draft' &&
      (message as DraftMessage).payload.questionId === 'q1'

    console.info('[TEST] sending attempt A under run 1, left permanently unacknowledged for now')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'attempt A' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))
    const attemptA = socket.sent.find(isQ1Draft)
    assert.ok(attemptA, 'expected attempt A to have been sent')
    const attemptADraftId = attemptA!.payload.draftId

    console.info('[TEST] the run restarts before attempt A settles, abandoning it')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: { ...snapshot, activeQuestionRunRevision: 2, activeQuestionRunStartedAt: Date.now() },
      })
    })

    console.info('[TEST] a fresh attempt B starts for the same question under run 2')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'attempt B' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))
    const sentAfterAttemptB = socket.sent.length
    assert.ok(
      socket.sent.slice(0, sentAfterAttemptB).some(
        (message) => isQ1Draft(message) && (message as DraftMessage).payload.activeQuestionRunRevision === 2,
      ),
      'expected attempt B to have been sent under run 2',
    )

    console.info('[TEST] attempt A’s stale ack now arrives, after B has already started')
    await act(async () => {
      socket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId: attemptADraftId } })
    })

    // Attempt B is still genuinely outstanding (never acked, never timed
    // out — DRAFT_SAVE_ACK_TIMEOUT_MS is 2s and we only wait one retry
    // tick). If A's stale settlement wrongly cleared B's in-flight marker,
    // the next retry tick would fire a third, duplicate send for q1.
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 300))
    const sentDuringRetryWindow = socket.sent.slice(sentAfterAttemptB).filter(isQ1Draft)
    assert.deepEqual(
      sentDuringRetryWindow,
      [],
      `expected no duplicate send while attempt B is still outstanding, got: ${JSON.stringify(sentDuringRetryWindow)}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('an unconfirmed draft on a backgrounded question tab is retried and saved after its QuestionView unmounts', async () => {
  // Regression test for issue #374: only the currently-selected question's
  // QuestionView is mounted. A save that hasn't been confirmed yet must
  // still reach the server after the student switches to another tab
  // (unmounting that QuestionView) rather than being silently lost.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { DRAFT_SAVE_ACK_TIMEOUT_MS } = await import('../hooks/useResonanceSession.js')
  const { act, render, waitFor } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
      { id: 'q2', type: 'free-response', text: 'Question two', order: 1 },
    ],
    activeQuestionIds: ['q1', 'q2'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never acknowledge a draft-save — this is the "unconfirmed" scenario.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    const firstTextarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    await act(async () => {
      const { fireEvent } = await import('@testing-library/react')
      fireEvent.change(firstTextarea, { target: { value: 'Answer left unconfirmed' } })
    })

    console.info('[TEST] switching tabs before the first question’s draft is acknowledged')
    await act(async () => {
      const { fireEvent } = await import('@testing-library/react')
      fireEvent.click(rendered.getByRole('button', { name: /^Q2/ }))
    })

    // The first question's QuestionView is now unmounted. Only the parent's
    // retry loop can still resend its draft. Wait past the debounced first
    // attempt's own ack timeout (DRAFT_SAVE_ACK_TIMEOUT_MS) plus another
    // retry tick, so the retry loop actually gets a chance to notice that
    // first attempt failed and send a second, distinct one — waiting only
    // one retry tick (as this test previously did) can't tell "the retry
    // loop resent a failed draft" apart from "only the original debounced
    // send happened," since the first attempt is still in flight (blocked
    // by its own ack timeout) at that point and the retry loop's own guard
    // skips a question with an attempt already in flight.
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_ACK_TIMEOUT_MS + DRAFT_RETRY_INTERVAL_MS + 500))

    type DraftMessage = { type: string; payload: { questionId?: string; draftId?: string; answer?: { text?: string } } }
    const isDraftMessage = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft'
    const q1Drafts = socket.sent.filter(isDraftMessage).filter((message) => message.payload.questionId === 'q1')
    assert.ok(
      q1Drafts.every((message) => message.payload.answer?.text === 'Answer left unconfirmed'),
      `expected every q1 draft attempt to carry the unconfirmed answer, got: ${JSON.stringify(q1Drafts)}`,
    )
    const distinctQ1DraftIds = new Set(q1Drafts.map((message) => message.payload.draftId))
    assert.ok(
      distinctQ1DraftIds.size >= 2,
      `expected the first attempt's ack timeout to trigger a second, distinct retry attempt for q1, got: ${JSON.stringify(q1Drafts)}`,
    )

    console.info('[TEST] the server now acknowledges the retried draft')
    const lastQ1DraftId = q1Drafts[q1Drafts.length - 1]!.payload.draftId
    assert.equal(typeof lastQ1DraftId, 'string')
    await act(async () => {
      socket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId: lastQ1DraftId } })
    })

    // Once acknowledged, the retry marker must clear: no further q1 draft
    // should be sent on subsequent retry ticks with nothing having changed.
    const sentBeforeFurtherRetries = socket.sent.length
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS * 2 + 500))
    const furtherQ1Drafts = socket.sent
      .slice(sentBeforeFurtherRetries)
      .filter(isDraftMessage)
      .filter((message) => message.payload.questionId === 'q1')
    assert.deepEqual(
      furtherQ1Drafts,
      [],
      `expected no further q1 retries after acknowledgement, got: ${JSON.stringify(furtherQ1Drafts)}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('an edit made shortly before a deadline is sent — and acknowledged — before that deadline passes', async () => {
  // Copilot review of PR #381: the debounce previously waited a fixed
  // DRAFT_EDIT_DEBOUNCE_MS (400ms) regardless of how little time was left
  // before the run's deadline. The server's update-draft handler silently
  // rejects (no ack) any write whose arrival time is at or past the
  // deadline (routes.ts), so an edit made in the final 400ms before a
  // deadline would debounce to *after* it and be guaranteed-rejected —
  // losing the student's last edit even though the client believed it was
  // "sent." A prior version of this test only asserted the message was
  // sent, which passed even for a doomed-to-be-rejected late send.
  // scheduleDraftSend now bounds its delay to the remaining time before the
  // deadline (leaving DRAFT_DEADLINE_BUFFER_MS of margin), so this test
  // both types with only DRAFT_DEADLINE_BUFFER_MS + a small margin left
  // before the deadline (proving the send fires quickly, not after the
  // full fixed debounce) and confirms the server would actually accept it
  // by simulating an acknowledgement and confirming the retry loop then
  // stops, rather than merely checking a message left the client.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  // Deliberately earlier than DRAFT_EDIT_DEBOUNCE_MS: the un-bounded 400ms
  // debounce would fire after this deadline; a bounded one fires well
  // before it (with DRAFT_DEADLINE_BUFFER_MS of margin still intact).
  const remainingBeforeDeadlineMs = Math.floor(DRAFT_EDIT_DEBOUNCE_MS * 0.75)
  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + remainingBeforeDeadlineMs,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    console.info('[TEST] editing right at the deadline boundary')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Last-second answer' } })
    })

    type DraftMessage = { type: string; payload: { questionId?: string; draftId?: string; answer?: { text?: string } } }
    const isQ1Draft = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null &&
      (message as { type?: string }).type === 'resonance:update-draft' &&
      (message as DraftMessage).payload.questionId === 'q1'

    // Comfortably past the bounded delay's expected fire time (deadline
    // minus the buffer) but well under the un-bounded DRAFT_EDIT_DEBOUNCE_MS
    // — if the debounce still waited the full fixed delay, nothing would
    // have been sent yet.
    await new Promise((resolve) => setTimeout(resolve, remainingBeforeDeadlineMs - 50))
    const draftMessages = socket.sent.filter(isQ1Draft)
    assert.ok(
      draftMessages.some((message) => message.payload.answer?.text === 'Last-second answer'),
      `expected the last-second answer to have been sent well before the fixed debounce delay, got: ${JSON.stringify(draftMessages)}`,
    )

    console.info('[TEST] the server accepts it (it genuinely arrived before the deadline) and acknowledges it')
    const draftId = draftMessages[0]!.payload.draftId
    assert.equal(typeof draftId, 'string')
    await act(async () => {
      socket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId } })
    })

    // Once acknowledged, the retry loop must not keep resending it.
    const sentBeforeFurtherRetries = socket.sent.length
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 300))
    const furtherQ1Drafts = socket.sent.slice(sentBeforeFurtherRetries).filter(isQ1Draft)
    assert.deepEqual(
      furtherQ1Drafts,
      [],
      `expected no further retries after acknowledgement, got: ${JSON.stringify(furtherQ1Drafts)}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('an edit made while an earlier attempt is still in flight is retried immediately once that attempt settles, not on the next interval tick', async () => {
  // Copilot review of PR #381: attemptDraftSend's in-flight guard silently
  // dropped a request to send whenever an earlier attempt for the same
  // question hadn't acked yet — it never queued or remembered that a newer
  // edit was waiting. The only thing left to pick it up was the fixed
  // DRAFT_RETRY_INTERVAL_MS backstop, running on its own schedule unrelated
  // to this event. Made close to a deadline (the scenario this most
  // matters for — see the "shortly before a deadline" test above), that gap
  // can easily exceed however much time is actually left, silently losing
  // the student's last edit even though scheduleDraftSend's own
  // deadline-clamping logic exists specifically to give it a fast chance to
  // beat the deadline.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: null,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))

    type DraftMessage = { type: string; payload: { questionId?: string; draftId?: string; answer?: { text?: string } } }
    const isQ1Draft = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null &&
      (message as { type?: string }).type === 'resonance:update-draft' &&
      (message as DraftMessage).payload.questionId === 'q1'

    console.info('[TEST] a first edit debounces and sends, left unacknowledged (still in flight)')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'First answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 100))
    const firstDrafts = socket.sent.filter(isQ1Draft)
    assert.equal(firstDrafts.length, 1, `expected exactly one send so far, got: ${JSON.stringify(socket.sent)}`)
    const firstDraftId = firstDrafts[0]!.payload.draftId

    console.info('[TEST] a second edit arrives, debounces, and its own send attempt finds the first still in flight')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Second answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 100))
    assert.equal(
      socket.sent.filter(isQ1Draft).length,
      1,
      'the second edit must not be sent as a concurrent duplicate while the first is still in flight',
    )

    console.info('[TEST] the first (now-stale) attempt is acknowledged, and the second edit must be sent right away — in the same settlement, not on the next retry-interval tick')
    await act(async () => {
      socket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId: firstDraftId } })
    })
    const draftsAfterAck = socket.sent.filter(isQ1Draft)
    assert.ok(
      draftsAfterAck.some((message) => message.payload.answer?.text === 'Second answer'),
      `expected the second edit to have been sent immediately upon the first's settlement, got: ${JSON.stringify(draftsAfterAck)}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a stale acknowledgement from a prior run does not confirm a new run’s coincidentally identical answer', async () => {
  // Regression test: content-only comparison (isSameAnswer) can't tell a
  // late ack for a superseded run's send apart from one for the current
  // run's send if the student types the same text again after a restart.
  // The ack must also be checked against the run revision and edit
  // sequence actually sent, or the new run's still-unconfirmed draft gets
  // wrongly marked confirmed before it was ever actually saved.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { DRAFT_SAVE_ACK_TIMEOUT_MS } = await import('../hooks/useResonanceSession.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never auto-ack — the test manually acknowledges specific draftIds below.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    console.info('[TEST] sending a draft under run 1 that is never acknowledged until after a restart')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    type DraftMessage = { type: string; payload: { questionId?: string; activeQuestionRunRevision?: number | null; draftId?: string; answer?: { text?: string } } }
    const isDraftMessage = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft'
    const firstRunDraft = socket.sent.filter(isDraftMessage).find((message) => message.payload.activeQuestionRunRevision === 1)
    assert.ok(firstRunDraft, 'expected the run-1 draft to have been sent')
    const staleDraftId = firstRunDraft!.payload.draftId
    assert.equal(typeof staleDraftId, 'string')

    console.info('[TEST] the run restarts before that draft is acknowledged')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: {
          ...snapshot,
          activeQuestionRunRevision: 2,
          activeQuestionRunStartedAt: Date.now(),
        },
      })
    })

    console.info('[TEST] the student retypes the exact same answer under the new run')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'hello' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    const secondRunDraft = socket.sent.filter(isDraftMessage).find((message) => message.payload.activeQuestionRunRevision === 2)
    assert.ok(secondRunDraft, 'expected a run-2 draft to have been sent')

    console.info('[TEST] the stale run-1 acknowledgement now arrives')
    await act(async () => {
      socket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId: staleDraftId } })
    })

    // If the stale ack wrongly cleared the run-2 draft's unconfirmed marker,
    // nothing would resend it once its own attempt naturally times out. The
    // run-2 send is still legitimately in-flight (its own attempt-token guard
    // correctly blocks a retry until it times out — see
    // "a stale settlement from an abandoned attempt..." above) so this has to
    // wait out that timeout before a genuinely new attempt can fire.
    const sentBeforeRetry = socket.sent.length
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_ACK_TIMEOUT_MS + DRAFT_RETRY_INTERVAL_MS + 300))

    const retriedRunTwoDraft = socket.sent
      .slice(sentBeforeRetry)
      .filter(isDraftMessage)
      .find((message) => message.payload.activeQuestionRunRevision === 2)
    assert.ok(
      retriedRunTwoDraft,
      'expected the run-2 draft to still be retried after the stale run-1 ack, since it was never actually acknowledged',
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('an edit made right after revisiting a just-submitted question is not blocked by its still-in-flight pre-submission draft', async () => {
  // Regression test (found via Copilot review of PR #381): onSubmitted only
  // cleared unconfirmedQuestionIdsRef, not inFlightDraftQuestionIdsRef. If a
  // draft send from before submission is still awaiting its ack, a student
  // who immediately revisits and edits the just-submitted question would
  // have that new edit silently blocked from sending until the old attempt
  // times out. clearDraftTracking (used from onSubmitted) fixes this by
  // clearing both markers together.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
      { id: 'q2', type: 'free-response', text: 'Question two', order: 1 },
    ],
    activeQuestionIds: ['q1', 'q2'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    if (url.includes('/submit-answer')) {
      return { ok: true, json: async () => ({ ok: true }) } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never auto-ack — the pre-submission draft send is left permanently
    // in-flight, exactly the condition that exposes the bug.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    console.info('[TEST] typing a draft that will never be acknowledged before submitting')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'first answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    type DraftMessage = { type: string; payload: { questionId?: string; answer?: { text?: string } } }
    const isQ1Draft = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null &&
      (message as { type?: string }).type === 'resonance:update-draft' &&
      (message as DraftMessage).payload.questionId === 'q1'
    assert.ok(socket.sent.some(isQ1Draft), 'expected the pre-submission draft to have been sent (and left unacked)')

    console.info('[TEST] submitting the question while that draft is still unacknowledged')
    await act(async () => {
      fireEvent.click(rendered.getByRole('button', { name: /Submit answer/i }))
      await Promise.resolve()
    })
    await waitFor(() => rendered.getByText(/answer submitted/i))

    console.info('[TEST] immediately revisiting and editing the just-submitted question')
    await act(async () => {
      fireEvent.click(rendered.getByRole('button', { name: /^Q1/ }))
    })
    const sentBeforeRevisitEdit = socket.sent.length
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'revised answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    const revisitDraft = socket.sent.slice(sentBeforeRevisitEdit).find(
      (message): message is DraftMessage =>
        isQ1Draft(message) && (message as DraftMessage).payload.answer?.text === 'revised answer',
    )
    assert.ok(
      revisitDraft,
      `expected the post-revisit edit to be sent promptly, not blocked by the stale pre-submission in-flight draft; sent since revisit: ${JSON.stringify(socket.sent.slice(sentBeforeRevisitEdit))}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a reload after a revisit whose local counter was already auto-seeded past the confirmed value still seeds correctly', async () => {
  // CodeRabbit review of PR #381: a prior investigation (Follow-up 7 item 2)
  // concluded seedEditSequenceFromConfirmedResponse's floor
  // (confirmedEditSequence + 1) always reconstructs a revisited draft's true
  // editSequence, reasoning that a revisit is the *only* way that counter
  // exceeds 1 and always computes `(current local value) + 1` against the
  // just-confirmed value. That reasoning missed a race: this same seed
  // effect runs automatically on *every* snapshot merge for a question with
  // a confirmed response, not just in response to an explicit revisit — and
  // the snapshot reflecting a just-submitted response (broadcast via
  // broadcastStudentSessionState) reaches this same client and gets merged
  // essentially immediately, well before a human can click a stack tab to
  // revisit. So by the time an explicit revisit happens, the local counter
  // has typically *already* been auto-seeded to confirmedEditSequence + 1,
  // and advanceEditSequenceForRevisit bumps *that* by one more — landing on
  // confirmedEditSequence + 2, not + 1. A reload after that revisit's own
  // edit would then re-seed from confirmedEditSequence + 1 alone, one below
  // what's actually stored, and every subsequent edit would be rejected as
  // stale by the server's ordering guard forever (nothing else ever bumps
  // the local counter again for a question the reloaded client doesn't
  // think is submitted — submittedQuestionIds isn't seeded from the
  // snapshot in live mode).
  //
  // Fixed by exposing draftEditSequences in StudentSessionSnapshot (the
  // stored draft's own editSequence, parallel to draftSendSequences) and
  // seeding from the greater of confirmedEditSequence + 1 and that value.
  //
  // This test drives the real sequence end to end: submit (real UI
  // interaction) -> the resulting broadcast snapshot lands (the automatic
  // seed) -> an explicit revisit -> an edit, landing at editSequence 3 ->
  // simulated reload reporting draftEditSequences: { q1: 3 } -> a further
  // edit, asserting it is sent at editSequence 3 (matching what is actually
  // stored), not 2.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
      { id: 'q2', type: 'free-response', text: 'Question two', order: 1 },
    ],
    activeQuestionIds: ['q1', 'q2'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    if (url.includes('/submit-answer')) {
      return { ok: true, json: async () => ({ ok: true }) } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    console.info('[TEST] submitting q1 through the real UI flow')
    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'first answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))
    await act(async () => {
      fireEvent.click(rendered.getByRole('button', { name: /Submit answer/i }))
      await Promise.resolve()
    })
    await waitFor(() => rendered.getByText(/answer submitted/i))

    console.info('[TEST] the broadcast session-state reflecting the confirmed response lands before any revisit')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: {
          ...snapshot,
          submittedAnswers: { q1: { type: 'free-response', text: 'first answer' } },
          submittedResponseEditSequences: { q1: 1 },
        },
      })
    })

    console.info('[TEST] revisiting and editing q1')
    await act(async () => {
      fireEvent.click(rendered.getByRole('button', { name: /^Q1/ }))
    })
    const sentBeforeRevisitEdit = socket.sent.length
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'revised answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    type DraftMessage = { type: string; payload: { questionId?: string; editSequence?: number; answer?: { text?: string } } }
    const isDraftMessage = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft'
    const revisitDraft = socket.sent.slice(sentBeforeRevisitEdit).find(
      (message): message is DraftMessage =>
        isDraftMessage(message) && message.payload.questionId === 'q1' && message.payload.answer?.text === 'revised answer',
    )
    assert.ok(revisitDraft, `expected the revisit edit to have been sent, got: ${JSON.stringify(socket.sent.slice(sentBeforeRevisitEdit))}`)
    assert.equal(
      revisitDraft!.payload.editSequence,
      3,
      'a revisit whose local counter was already auto-seeded to 2 must land on 3, not 2 — this is what the server actually stores',
    )

    console.info('[TEST] simulating a reload: remount reporting the server’s actual stored draft, including its editSequence')
    await act(async () => {
      rendered.unmount()
    })
    const postReloadSnapshot = {
      ...snapshot,
      submittedAnswers: { q1: { type: 'free-response', text: 'first answer' } },
      submittedResponseEditSequences: { q1: 1 },
      draftAnswers: { q1: { type: 'free-response', text: 'revised answer' } },
      draftSendSequences: { q1: 1 },
      draftEditSequences: { q1: 3 },
    }
    ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/register-student')) {
        return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
      }
      if (url.includes('/state')) {
        return { ok: true, json: async () => postReloadSnapshot } as Response
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    let reloaded!: ReturnType<typeof render>
    await act(async () => {
      reloaded = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 2))
    const reloadedSocket = FakeWebSocket.instances[1]!
    reloadedSocket.send = (message: string) => { reloadedSocket.sent.push(JSON.parse(message)) }

    const restoredTextarea = await waitFor(() => reloaded.getByLabelText(/your answer/i))
    assert.equal((restoredTextarea as HTMLTextAreaElement).value, 'revised answer')

    console.info('[TEST] editing again post-reload, without another explicit revisit')
    await act(async () => {
      fireEvent.change(restoredTextarea, { target: { value: 'revised again after reload' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    const postReloadDraft = reloadedSocket.sent.filter(isDraftMessage).find(
      (message) => message.payload.questionId === 'q1' && message.payload.answer?.text === 'revised again after reload',
    )
    assert.ok(postReloadDraft, `expected the post-reload edit to have been sent, got: ${JSON.stringify(reloadedSocket.sent)}`)
    assert.equal(
      postReloadDraft!.payload.editSequence,
      3,
      'the post-reload edit must be seeded from the stored draft’s own editSequence (3), not confirmedEditSequence + 1 (2) alone',
    )

    await act(async () => {
      reloaded.unmount()
    })
  } finally {
    restore()
  }
})

void test('an edit after a simulated reload is sent with a draftSendSequence higher than what the server already has', async () => {
  // Regression test (Copilot review of PR #381): nextDraftSendSequenceRef is
  // component-local and restarts at 0 on mount (simulating a page reload).
  // Without seeding it from the server's draftSendSequences, a plain,
  // non-revisit edit of a restored draft (same editSequence as what's
  // already stored) would be sent with draftSendSequence 1 — lower than
  // whatever the server already has — and the update-draft ordering guard
  // would reject it as stale, silently dropping the edit.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  // Simulates a page reload: the server already holds a draft (from before
  // the reload) with a draftSendSequence of 7, at the same editSequence the
  // client will resolve to (no revisit has happened).
  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
    draftAnswers: { q1: { type: 'free-response', text: 'Typed before the reload' } },
    draftSendSequences: { q1: 7 },
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    assert.equal((textarea as HTMLTextAreaElement).value, 'Typed before the reload')

    console.info('[TEST] editing the restored draft without a revisit')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Typed after the reload' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    type DraftMessage = { type: string; payload: { questionId?: string; draftSendSequence?: number; answer?: { text?: string } } }
    const isDraftMessage = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft'
    const postReloadDraft = socket.sent.filter(isDraftMessage).find(
      (message) => message.payload.answer?.text === 'Typed after the reload',
    )
    assert.ok(postReloadDraft, `expected the post-reload edit to have been sent, got: ${JSON.stringify(socket.sent)}`)
    assert.ok(
      (postReloadDraft!.payload.draftSendSequence ?? 0) > 7,
      `expected draftSendSequence to be ratcheted above the server's stored value (7), got: ${postReloadDraft!.payload.draftSendSequence}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a restored draft answer wins over a stale submitted answer on initial load', async () => {
  // Copilot review of PR #381: the snapshot-merge effect spread
  // snapshot.submittedAnswers *after* snapshot.draftAnswers, so on the very
  // first merge after mount (a fresh page load/remount, before local state
  // has any value for the question yet) a stale confirmed answer would win
  // over a strictly newer, still-unconfirmed post-submission-revisit draft —
  // exactly the in-progress edit draftAnswers exists to recover.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent } = await import('./ResonanceStudent.js')
  const { render, waitFor, act } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
    submittedAnswers: { q1: { type: 'free-response', text: 'Old confirmed answer' } },
    submittedResponseEditSequences: { q1: 1 },
    draftAnswers: { q1: { type: 'free-response', text: 'Newer unconfirmed revision' } },
    draftSendSequences: { q1: 2 },
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    assert.equal(
      (textarea as HTMLTextAreaElement).value,
      'Newer unconfirmed revision',
      'expected the restored draft to win over the stale confirmed answer',
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('an edit after a simulated reload during a revisit is sent with the same editSequence the stored draft already has', async () => {
  // Copilot review of PR #381: claimed the snapshot restores draftSendSequence
  // but not the stored draft's own editSequence, so after a reload mid-revisit
  // the client would seed its edit-sequence counter only from
  // submittedResponseEditSequences (the *confirmed* response's sequence) and
  // send the next edit at a lower editSequence than the stored draft already
  // has, getting rejected as stale by the server's ordering guard.
  //
  // Investigation: seedEditSequenceFromConfirmedResponse's floor is
  // `confirmedEditSequence + 1` — and that's exactly the value
  // advanceEditSequenceForRevisit itself would have produced for a single
  // revisit against that same confirmed value (the only way a draft's
  // editSequence gets bumped past 1 in the first place). So as long as at
  // most one revisit happened since the last confirmed submission (the only
  // way to reach a second revisit is to resubmit first, which advances the
  // confirmed value the next seed would use), the seeded floor always
  // reconstructs exactly what the stored draft already has. This test builds
  // exactly the scenario described — submit, revisit, edit (leaving a draft
  // stored server-side at editSequence 2), reload — and confirms the very
  // next post-reload send already carries editSequence 2, matching what's
  // stored, not editSequence 1.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  // Simulates a reload after: submit (editSequence 1, confirmed) -> revisit
  // (bumps to editSequence 2) -> edit, saved as a draft server-side at
  // editSequence 2, draftSendSequence 9 -> reload, before resubmitting again.
  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
    submittedResponseEditSequences: { q1: 1 },
    draftAnswers: { q1: { type: 'free-response', text: 'Revised after the first submission' } },
    draftSendSequences: { q1: 9 },
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    assert.equal((textarea as HTMLTextAreaElement).value, 'Revised after the first submission')

    console.info('[TEST] editing the restored draft further, without another explicit revisit')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Revised again after the reload' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    type DraftMessage = { type: string; payload: { questionId?: string; editSequence?: number; answer?: { text?: string } } }
    const isDraftMessage = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft'
    const postReloadDraft = socket.sent.filter(isDraftMessage).find(
      (message) => message.payload.answer?.text === 'Revised again after the reload',
    )
    assert.ok(postReloadDraft, `expected the post-reload edit to have been sent, got: ${JSON.stringify(socket.sent)}`)
    assert.equal(
      postReloadDraft!.payload.editSequence,
      2,
      `expected the seeded editSequence to match the stored draft's own editSequence (2), got: ${postReloadDraft!.payload.editSequence}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a message delivered on an abandoned identity’s connection cannot confirm a new identity’s coincidentally identical answer', async () => {
  // Investigated after a Copilot review of PR #381 suggested attemptDraftSend's
  // ack continuation needed to check which session/student a draft was sent
  // under, since pendingDraftSavesRef (in useResonanceSession) is a ref tied
  // to the mounted ResonanceStudent instance, not to any one sessionId/studentId
  // pairing, and so survives an identity change. Investigation found that scoping
  // check unnecessary: useResonanceSession's ws.onmessage handler is gated by
  // its own isCurrent() check (`wsRef.current === socket`), which is already
  // false the instant an identity change's cleanup runs (wsRef.current is set
  // to null synchronously, before the new socket is even created) — so a
  // message arriving on an abandoned identity's socket is dropped before it's
  // even parsed, regardless of whether/when that real WebSocket's own close
  // event eventually fires. This test locks in that existing protection: it
  // delivers a message on an abandoned session's socket that would otherwise
  // wrongly confirm a new session's coincidentally identical answer, and
  // confirms it has no effect.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { createMemoryRouter, RouterProvider } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { DRAFT_SAVE_ACK_TIMEOUT_MS } = await import('../hooks/useResonanceSession.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')
  persistSessionParticipantIdentity(window.localStorage, 'session-2', 'Bea', 'student-2')

  const buildSessionSnapshot = (sessionId: string) => buildSnapshot({
    sessionId,
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })
  const snapshotsBySessionId: Record<string, StudentSessionSnapshot> = {
    'session-1': buildSessionSnapshot('session-1'),
    'session-2': buildSessionSnapshot('session-2'),
  }

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/session-1/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/session-2/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-2', name: 'Bea' }) } as Response
    }
    if (url.includes('/session-1/state')) {
      return { ok: true, json: async () => snapshotsBySessionId['session-1'] } as Response
    }
    if (url.includes('/session-2/state')) {
      return { ok: true, json: async () => snapshotsBySessionId['session-2'] } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  const router = createMemoryRouter(
    [{ path: '/:sessionId', element: React.createElement(ResonanceStudent) }],
    { initialEntries: ['/session-1'] },
  )

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(React.createElement(RouterProvider, { router }))
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const session1Socket = FakeWebSocket.instances[0]!
    // Never auto-ack — the test manually delivers the stale ack below.
    session1Socket.send = (message: string) => { session1Socket.sent.push(JSON.parse(message)) }

    type DraftMessage = { type: string; payload: { questionId?: string; draftId?: string; answer?: { text?: string } } }
    const isDraftMessage = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft'

    console.info('[TEST] session-1/student-1 sends a draft that is never acknowledged before the identity changes')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'hello' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))
    const session1Draft = session1Socket.sent.find(isDraftMessage)
    assert.ok(session1Draft, 'expected a draft to have been sent for session-1')
    const staleDraftId = session1Draft!.payload.draftId
    assert.equal(typeof staleDraftId, 'string')

    console.info('[TEST] navigating to a different session (a different identity) before that draft is acknowledged')
    await act(async () => {
      await router.navigate('/session-2')
    })
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 2))
    const session2Socket = FakeWebSocket.instances[1]!
    session2Socket.send = (message: string) => { session2Socket.sent.push(JSON.parse(message)) }

    console.info('[TEST] the new identity answers the same question with the same, coincidentally identical text')
    const session2Textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    await act(async () => {
      fireEvent.change(session2Textarea, { target: { value: 'hello' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))
    const session2Draft = session2Socket.sent.find(isDraftMessage)
    assert.ok(session2Draft, 'expected a draft to have been sent for session-2')

    console.info('[TEST] a message for the abandoned session-1 draft arrives on session-1’s old socket object')
    await act(async () => {
      session1Socket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId: staleDraftId } })
    })

    // session-2's own send is still legitimately in flight (never acked) —
    // it only becomes retriable once its own ack timeout elapses. If the
    // message on session-1's abandoned socket had wrongly reached
    // session-2's tracking and confirmed it, nothing would resend it here.
    const sentBeforeRetry = session2Socket.sent.length
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_ACK_TIMEOUT_MS + DRAFT_RETRY_INTERVAL_MS + 300))
    const retriedSession2Draft = session2Socket.sent.slice(sentBeforeRetry).find(isDraftMessage)
    assert.ok(
      retriedSession2Draft,
      'expected session-2’s draft to still be retried once its own ack timeout elapsed, since it was never actually acknowledged',
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a prior-run confirmed answer resurfacing from a later snapshot is not auto-resent as a live draft', async () => {
  // Investigated after a Copilot review of PR #381 suggested that
  // resetAnswersForRestartedQuestions's local-cache reset is undone by the
  // very next snapshot merge (since snapshot.submittedAnswers is
  // intentionally run-independent — see "reactivating a question keeps
  // prior answers editable for students" in routes.test.ts — so a
  // reactivated question's prior confirmed answer legitimately resurfaces
  // there), and that this could "let the retry path resend the stale
  // answer under the new run."
  //
  // Investigation found that specific claim doesn't hold: attemptDraftSend
  // only ever resends a question that's in unconfirmedQuestionIdsRef, and
  // nothing adds a question there except an actual edit (onDraftChanged) —
  // the snapshot-merge effect that resurfaces the prior answer never
  // touches that set. So the prior answer resurfacing (intended, matching
  // "editable prior answer") and it getting auto-resent as a live draft
  // (not intended, and not what happens) are two different things. This
  // test locks in the second half: reactivating a question does not, on
  // its own, cause anything to be sent to the server.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const priorAnswer = { type: 'free-response' as const, text: 'Prior confirmed answer' }
  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
    submittedAnswers: { q1: priorAnswer },
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    console.info('[TEST] the run restarts, reactivating q1 with its prior confirmed answer still on the snapshot')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: { ...snapshot, activeQuestionRunRevision: 2, activeQuestionRunStartedAt: Date.now() },
      })
    })

    // A second, later Copilot review flagged this same reset as blanking the
    // reactivated question until "some unrelated later snapshot arrives,"
    // reasoning that resetAnswersForRestartedQuestions deletes the local
    // cache entry the merge just above it had set. Investigated directly:
    // deleting the local entry does not blank the *display*, because
    // QuestionView's initialAnswer is computed by resolveQuestionAnswer,
    // which falls back to snapshot.submittedAnswers precisely when the local
    // cache has no entry for a question — and that's exactly this snapshot's
    // own submittedAnswers, still holding the prior confirmed answer. This
    // assertion (checking after only the *one* reactivation snapshot, not
    // the second one below) locks that in.
    assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      priorAnswer.text,
      'expected the prior confirmed answer to still be visible right after the single reactivation snapshot, not just after a later one',
    )

    console.info('[TEST] a later snapshot update re-merges the same (run-independent) prior confirmed answer')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: { ...snapshot, activeQuestionRunRevision: 2, activeQuestionRunStartedAt: Date.now() },
      })
    })

    const textarea = await waitFor(() => rendered.getByLabelText(/your answer/i))
    assert.equal(
      (textarea as HTMLTextAreaElement).value,
      priorAnswer.text,
      'expected the reactivated question to prefill with the prior answer (matching "reactivating a question keeps prior answers editable")',
    )

    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 300))
    const draftMessages = socket.sent.filter(
      (message): message is { type: string } => typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft',
    )
    assert.deepEqual(
      draftMessages,
      [],
      `expected nothing to be sent to the server without an actual edit, got: ${JSON.stringify(draftMessages)}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('an unconfirmed live-run draft is not retried into self-paced mode and does not overwrite an unrelated pre-existing self-paced draft', async () => {
  // CodeRabbit flagged (PR #381) that the selfPacedMode branch of the
  // snapshot-merge effect never calls clearDraftTracking on a live-run
  // transition, unlike the live-mode branch (which does so on a run
  // restart/reactivation). An earlier investigation of that same claim
  // concluded no fix was needed, reasoning only about whether the draft's
  // tracking survives the transition (it does, since self-paced exposes a
  // superset of whatever was live-active) — not about what happens if the
  // retried write actually reaches the server under the new identity.
  //
  // A closer trace (Copilot review, same PR) found a real corruption path
  // that reasoning missed: a draft's server-side storage slot is keyed only
  // by questionId+studentId, not by run revision (see buildDraftKey in
  // routes.ts), and the update-draft ordering guard's same-editSequence
  // tiebreaker (draftSendSequence) is a session-global counter, blind to
  // which run an attempt conceptually belongs to. So a stale unconfirmed
  // live-run edit — never actually persisted, because it never got acked —
  // retried under self-paced's null revision can still win that tiebreak
  // against, and silently overwrite, a genuinely different self-paced draft
  // for the same question that predates the live run and was never touched
  // by it. This test locks in the corrected behavior: a question leaving a
  // live context has its stale local tracking reset, so the retry loop
  // stops resending it and the snapshot's own (different) self-paced draft
  // is recovered instead.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { DRAFT_SAVE_ACK_TIMEOUT_MS } = await import('../hooks/useResonanceSession.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never auto-ack — this draft stays unconfirmed across the transition.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    type DraftMessage = { type: string; payload: { questionId?: string; activeQuestionRunRevision?: number | null; answer?: { text?: string } } }
    const isQ1Draft = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null &&
      (message as { type?: string }).type === 'resonance:update-draft' &&
      (message as DraftMessage).payload.questionId === 'q1'

    console.info('[TEST] typing an answer under live mode, left unacknowledged')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'live-mode answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))
    assert.ok(
      socket.sent.some((message) => isQ1Draft(message) && message.payload.activeQuestionRunRevision === 1),
      'expected the live-mode attempt to have been sent',
    )

    // The server never acknowledged that attempt, so the draft it's storing
    // for q1 is still whatever pre-existing self-paced draft was there
    // before this live run started — unrelated content the live edit never
    // touched. The self-paced push below reports that value back, exactly
    // as the server would.
    console.info('[TEST] the session transitions to self-paced mode before that draft is acknowledged, reporting an unrelated pre-existing self-paced draft')
    const sentBeforeTransition = socket.sent.length
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: {
          ...snapshot,
          selfPacedMode: true,
          activeQuestionRunRevision: null,
          activeQuestionRunStartedAt: null,
          activeQuestionDeadlineAt: null,
          // The server always stamps the highest live revision it has ever
          // assigned here, even on a self-paced/idle snapshot (see
          // shouldApplyStudentSessionSnapshot) — without it, this snapshot
          // looks indistinguishable from a stale delayed idle push and gets
          // rejected by the client's own ordering guard.
          lastActiveQuestionRunRevision: 1,
          draftAnswers: { q1: { type: 'free-response', text: 'Pre-existing self-paced draft' } },
          draftSendSequences: { q1: 1 },
        },
      })
    })

    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_ACK_TIMEOUT_MS + DRAFT_RETRY_INTERVAL_MS + 300))
    const sentAfterTransition = socket.sent.slice(sentBeforeTransition)
    assert.ok(
      !sentAfterTransition.some((message) => isQ1Draft(message) && (message as DraftMessage).payload.answer?.text === 'live-mode answer'),
      `expected the stale live-mode draft not to be retried into self-paced mode, got: ${JSON.stringify(sentAfterTransition)}`,
    )
    assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'Pre-existing self-paced draft',
      'expected the unrelated pre-existing self-paced draft to be recovered instead of the stale live-mode edit',
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a live run ending into a fully idle state does not leave an unconfirmed draft stranded', async () => {
  // Copilot review of PR #381: the live-to-self-paced fix above only resets
  // stale draft tracking/local answer cache when the destination snapshot
  // is self-paced. A live run can also end into a fully idle state — no
  // active questions at all, and not self-paced (the server clears
  // activeQuestionIds and reverts activeQuestionRunRevision to null either
  // way; see setActiveQuestions/clearActiveQuestions in routes.ts) — which
  // that fix's `snapshot.selfPacedMode` condition didn't cover. This case
  // is actually worse than the self-paced one: since the question is no
  // longer in activeQuestionIds at all, selectUnconfirmedDraftQuestionIds's
  // filter drops it from every future retry tick regardless of tracking
  // state, so the retry-interval effect's own deadline-reconciliation
  // branch never even runs for it — nothing was ever going to clear the
  // stale marker/local cache on its own.
  //
  // The bug isn't observable at the idle state itself (no active question
  // is rendered there to show a stale value), so this test makes it
  // observable the same way the self-paced test above does: transition
  // through idle first, then into self-paced later, and confirm the
  // self-paced snapshot's own (different) draft is recovered instead of
  // the stale live-mode edit surviving untouched through the idle step.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never auto-ack — this draft stays unconfirmed across both transitions.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    console.info('[TEST] typing an answer under live mode, left unacknowledged')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'live-mode answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    console.info('[TEST] the run ends into a fully idle state (no self-paced fallback) before that draft is acknowledged')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: {
          ...snapshot,
          selfPacedMode: false,
          activeQuestions: [],
          activeQuestionIds: [],
          activeQuestionRunRevision: null,
          activeQuestionRunStartedAt: null,
          activeQuestionDeadlineAt: null,
          lastActiveQuestionRunRevision: 1,
        },
      })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 300))

    console.info('[TEST] the session later turns on self-paced mode, reporting an unrelated pre-existing self-paced draft')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: {
          ...snapshot,
          selfPacedMode: true,
          activeQuestionRunRevision: null,
          activeQuestionRunStartedAt: null,
          activeQuestionDeadlineAt: null,
          lastActiveQuestionRunRevision: 1,
          draftAnswers: { q1: { type: 'free-response', text: 'Pre-existing self-paced draft' } },
          draftSendSequences: { q1: 1 },
        },
      })
    })

    await waitFor(() => assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'Pre-existing self-paced draft',
    ))

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a staged run\'s superseded question does not resurrect a stale answer after the run ends', async () => {
  // Copilot review of PR #381: a staged run advancing to its next question
  // bumps activeQuestionRunRevision (see advance-staged-question in
  // routes.ts) and narrows activeQuestionIds down to just the next
  // question. The reactivatedIds/didRunRestart reset in the snapshot-merge
  // effect only resets the *incoming* ids (activeIds when didRunRestart),
  // never the id that just left — so a still-unconfirmed draft/local answer
  // for the question that was just advanced away from is left tracked.
  // previousActiveQuestionIdsRef is then overwritten to the new (narrower)
  // active set on every merge, so that orphaned id also falls out of
  // idsLeavingLiveContext's own reach once the run eventually ends — it
  // only ever remembers the *last* active set, not one from several stages
  // back. Left unfixed, the stale answer can resurface and retry once the
  // run ends, silently overwriting an unrelated, already-legitimate draft
  // for the same question.
  //
  // Not observable while the superseded question is off-screen (nothing
  // renders it), so this test makes it observable the same way the
  // idle-ending test above does: advance the staged run away from q1, let
  // the run end into self-paced reporting a different, pre-existing q1
  // draft, and confirm that pre-existing draft is what's actually shown.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_EDIT_DEBOUNCE_MS, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    presentationMode: 'staged',
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    activeQuestionDeadlineAt: Date.now() + 60_000,
  })

  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      return { ok: true, json: async () => snapshot } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never auto-ack — this draft stays unconfirmed through the advance.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    console.info('[TEST] typing an answer for the first staged question, left unacknowledged')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'live-mode answer' } })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 200))

    console.info('[TEST] the staged run advances to its next question, superseding q1 before its draft is acknowledged')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: {
          ...snapshot,
          activeQuestions: [
            { id: 'q2', type: 'free-response', text: 'Question two', order: 1 },
          ],
          activeQuestionIds: ['q2'],
          activeQuestionRunRevision: 2,
          activeQuestionRunStartedAt: Date.now(),
          activeQuestionDeadlineAt: Date.now() + 60_000,
        },
      })
    })
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 300))

    console.info('[TEST] the staged run ends into self-paced mode, reporting an unrelated pre-existing q1 draft')
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:session-state',
        payload: {
          ...snapshot,
          selfPacedMode: true,
          activeQuestionRunRevision: null,
          activeQuestionRunStartedAt: null,
          activeQuestionDeadlineAt: null,
          lastActiveQuestionRunRevision: 2,
          draftAnswers: { q1: { type: 'free-response', text: 'Pre-existing self-paced draft' } },
          draftSendSequences: { q1: 1 },
        },
      })
    })

    await waitFor(() => assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'Pre-existing self-paced draft',
    ))

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a failed deadline reconciliation refresh does not strand the client, and retries on the next tick', async () => {
  // CodeRabbit review of PR #381: the deadline-reconciliation branch of the
  // retry-interval effect used to mark reconciledExpiryRef and clear draft
  // tracking/local answer *before* refresh() resolved. If refresh() (a
  // network fetch) failed, the client would already have discarded its own
  // optimistic local value and would never retry reconciling this run's
  // deadline again — reconciledExpiryRef would already claim it as handled,
  // permanently stranding the client without ever having actually retrieved
  // the server's finalized state.
  const restore = installResonanceStudentTestEnvironment()
  const { persistSessionParticipantIdentity } = await import(
    '@src/components/common/entryParticipantIdentityUtils'
  )
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { default: ResonanceStudent, DRAFT_RETRY_INTERVAL_MS } = await import('./ResonanceStudent.js')
  const { act, render, waitFor, fireEvent } = await import('@testing-library/react')

  persistSessionParticipantIdentity(window.localStorage, 'session-1', 'Ada', 'student-1')

  const snapshot = buildSnapshot({
    activeQuestions: [
      { id: 'q1', type: 'free-response', text: 'Question one', order: 0 },
    ],
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: Date.now(),
    activeQuestionRunRevision: 1,
    // Passes almost immediately, well before the retry interval's first
    // tick, so the very first tick already sees the deadline as past.
    activeQuestionDeadlineAt: Date.now() + 100,
  })

  let stateFetchCount = 0
  ;(globalThis as { fetch?: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/register-student')) {
      return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ada' }) } as Response
    }
    if (url.includes('/state')) {
      stateFetchCount += 1
      // Call 1: the initial mount fetch — succeeds normally.
      if (stateFetchCount === 1) {
        return { ok: true, json: async () => snapshot } as Response
      }
      // Call 2: the first deadline-reconciliation attempt — fails.
      if (stateFetchCount === 2) {
        throw new Error('simulated network failure')
      }
      // Call 3+: the next reconciliation attempt — succeeds, reporting the
      // server's finalized answer (distinct from the locally-typed one, so
      // recovering it is observable).
      return {
        ok: true,
        json: async () => ({
          ...snapshot,
          submittedAnswers: { q1: { type: 'free-response', text: 'Server-finalized answer' } },
        }),
      } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch

  let rendered!: ReturnType<typeof render>
  try {
    await act(async () => {
      rendered = render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/session-1'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) }),
          ),
        ),
      )
      await Promise.resolve()
    })

    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const socket = FakeWebSocket.instances[0]!
    // Never auto-ack — this draft stays unconfirmed past its deadline.
    socket.send = (message: string) => { socket.sent.push(JSON.parse(message)) }

    console.info('[TEST] typing an answer that never gets acknowledged before the deadline passes')
    await act(async () => {
      fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'Locally typed answer' } })
    })

    console.info('[TEST] the first reconciliation attempt (after the deadline passes) fails')
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 300))
    assert.ok(stateFetchCount >= 2, `expected a reconciliation refresh attempt, got ${stateFetchCount} /state calls`)
    assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'Locally typed answer',
      'a failed refresh must not discard the local value it could not yet replace',
    )

    console.info('[TEST] the next reconciliation attempt succeeds and recovers the server-finalized answer')
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 300))
    assert.ok(stateFetchCount >= 3, `expected a retried reconciliation refresh, got ${stateFetchCount} /state calls`)

    // Copilot review of PR #381: resetting the parent's submittedAnswers
    // cache alone isn't enough — QuestionView deliberately ignores a changed
    // initialAnswer prop while its own local draftAnswer still differs from
    // what it last synchronized (so an ordinary parent re-render never yanks
    // away in-progress typing), and this same QuestionView instance stays
    // mounted (just disabled) past the deadline, not remounted. Without an
    // explicit reconciliation signal forcing a remount, the disabled input
    // would keep showing the discarded "Locally typed answer" forever after
    // a successful reconciliation, even though the server actually finalized
    // something else. Folding a per-question reconciliation generation into
    // QuestionView's key forces exactly that remount once reconciliation
    // succeeds, so the fresh initialAnswer prop is adopted immediately.
    await waitFor(() => assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'Server-finalized answer',
      'a successful reconciliation must replace the discarded optimistic answer in the still-mounted, disabled input',
    ))

    // Once reconciliation succeeds, q1 is no longer tracked as unconfirmed:
    // a further retry tick must neither resend the now-superseded local
    // draft nor kick off another reconciliation refresh for the same
    // run/deadline (reconciledExpiryRef now correctly reflects success).
    console.info('[TEST] a further retry tick neither resends the stale draft nor re-reconciles')
    const stateFetchCountAfterSuccess = stateFetchCount
    const sentCountAfterSuccess = socket.sent.length
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS * 2 + 300))
    assert.equal(
      stateFetchCount,
      stateFetchCountAfterSuccess,
      'expected no further reconciliation refresh once this run/deadline was successfully reconciled',
    )
    type DraftMessage = { type: string; payload: { questionId?: string } }
    const isQ1Draft = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null &&
      (message as { type?: string }).type === 'resonance:update-draft' &&
      (message as DraftMessage).payload.questionId === 'q1'
    const q1DraftsAfterSuccess = socket.sent.slice(sentCountAfterSuccess).filter(isQ1Draft)
    assert.deepEqual(
      q1DraftsAfterSuccess,
      [],
      `expected no further q1 draft resends once reconciled, got: ${JSON.stringify(q1DraftsAfterSuccess)}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

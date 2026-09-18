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
import { clearDraftTracking } from './ResonanceStudent.js'
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
    questionIds: string[]
    expectedUnconfirmed: string[]
    expectedInFlight: string[]
  }> = [
    {
      name: 'in both sets and named: cleared from both',
      unconfirmed: ['q1'],
      inFlight: ['q1'],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
    },
    {
      name: 'unconfirmed only (no attempt ever started): still safe to clear',
      unconfirmed: ['q1'],
      inFlight: [],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
    },
    {
      name: 'in-flight only (already confirmed, still awaiting ack): still safe to clear',
      unconfirmed: [],
      inFlight: ['q1'],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
    },
    {
      name: 'present in both but not named: left untouched',
      unconfirmed: ['q1', 'q2'],
      inFlight: ['q1', 'q2'],
      questionIds: ['q2'],
      expectedUnconfirmed: ['q1'],
      expectedInFlight: ['q1'],
    },
    {
      name: 'named but absent from both sets: no-op, no error',
      unconfirmed: [],
      inFlight: [],
      questionIds: ['q1'],
      expectedUnconfirmed: [],
      expectedInFlight: [],
    },
    {
      name: 'empty questionIds: no-op even when both sets are populated',
      unconfirmed: ['q1'],
      inFlight: ['q1'],
      questionIds: [],
      expectedUnconfirmed: ['q1'],
      expectedInFlight: ['q1'],
    },
  ]

  for (const testCase of cases) {
    const unconfirmedQuestionIds = new Set(testCase.unconfirmed)
    const inFlightDraftQuestionIds = new Map(testCase.inFlight.map((questionId) => [questionId, 1]))
    clearDraftTracking({ unconfirmedQuestionIds, inFlightDraftQuestionIds, questionIds: testCase.questionIds })
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
    // retry loop can still resend its draft.
    await new Promise((resolve) => setTimeout(resolve, DRAFT_RETRY_INTERVAL_MS + 500))

    type DraftMessage = { type: string; payload: { questionId?: string; draftId?: string; answer?: { text?: string } } }
    const isDraftMessage = (message: unknown): message is DraftMessage =>
      typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft'
    const q1Drafts = socket.sent.filter(isDraftMessage).filter((message) => message.payload.questionId === 'q1')
    assert.ok(
      q1Drafts.some((message) => message.payload.answer?.text === 'Answer left unconfirmed'),
      `expected a retried draft for q1, got: ${JSON.stringify(q1Drafts)}`,
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

void test('an edit made shortly before a deadline is still sent, even once the deadline has passed by the time it fires', async () => {
  // Regression test: the retry interval fires on a fixed schedule from
  // mount, not re-armed by edits, so an edit made just before a deadline
  // could otherwise wait past it for the next tick. The edit-triggered
  // debounce (DRAFT_EDIT_DEBOUNCE_MS) must fire regardless, and the send
  // itself must not skip just because the client's own clock now reads
  // past the deadline — the server is the actual authority on that.
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
    // Deliberately earlier than DRAFT_EDIT_DEBOUNCE_MS, so the debounced
    // send fires *after* this deadline has already passed.
    activeQuestionDeadlineAt: Date.now() + Math.floor(DRAFT_EDIT_DEBOUNCE_MS / 2),
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
    console.info('[TEST] editing right at the deadline boundary; the debounced send fires after it has passed')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Last-second answer' } })
    })

    await new Promise((resolve) => setTimeout(resolve, DRAFT_EDIT_DEBOUNCE_MS + 300))

    const draftMessages = socket.sent.filter(
      (message): message is { type: string; payload: { questionId?: string; answer?: { text?: string } } } =>
        typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft',
    )
    assert.ok(
      draftMessages.some((message) =>
        message.payload.questionId === 'q1' && message.payload.answer?.text === 'Last-second answer'),
      `expected the last-second answer to still be sent, got: ${JSON.stringify(draftMessages)}`,
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

void test('an unconfirmed draft survives a live-to-self-paced mode transition and is still retried', async () => {
  // CodeRabbit review of PR #381: the selfPacedMode branch of the
  // snapshot-merge effect never calls clearDraftTracking (unlike the
  // live-mode branch, which does so on a run restart/reactivation), and
  // flagged that as a gap that could strand an unconfirmed draft's tracking
  // across a live-to-self-paced transition.
  //
  // Investigation: unconfirmedQuestionIdsRef/inFlightDraftQuestionIdsRef are
  // keyed by questionId only, not by run identity, and the periodic retry
  // loop (selectUnconfirmedDraftQuestionIds) filters by whatever the
  // *current* snapshot's activeQuestions are — it doesn't care whether that
  // snapshot is live or self-paced, or whether the run revision changed
  // underneath it. So as long as the question stays present in the new
  // snapshot's activeQuestions (self-paced makes every question available,
  // a superset of whatever was live-active), an unconfirmed draft's tracking
  // survives the transition intact and keeps retrying under the new
  // (self-paced, revision-null) context. This test locks in that no fix is
  // needed here: the mode transition must not strand the draft.
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

    console.info('[TEST] the session transitions to self-paced mode before that draft is acknowledged')
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
        },
      })
    })

    await new Promise((resolve) => setTimeout(resolve, DRAFT_SAVE_ACK_TIMEOUT_MS + DRAFT_RETRY_INTERVAL_MS + 300))
    const retriedUnderSelfPaced = socket.sent
      .slice(sentBeforeTransition)
      .filter((message) => isQ1Draft(message) && message.payload.activeQuestionRunRevision === null)
    assert.ok(
      retriedUnderSelfPaced.some((message) => (message as DraftMessage).payload.answer?.text === 'live-mode answer'),
      `expected the still-unconfirmed draft to be retried under self-paced mode, got: ${JSON.stringify(socket.sent.slice(sentBeforeTransition))}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

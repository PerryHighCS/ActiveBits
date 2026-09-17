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

    const draftMessages = socket.sent.filter(
      (message): message is { type: string; payload: { questionId?: string; answer?: { text?: string } } } =>
        typeof message === 'object' && message !== null && (message as { type?: string }).type === 'resonance:update-draft',
    )
    assert.ok(
      draftMessages.some((message) =>
        message.payload.questionId === 'q1' && message.payload.answer?.text === 'Answer left unconfirmed'),
      `expected a retried draft for q1, got: ${JSON.stringify(draftMessages)}`,
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

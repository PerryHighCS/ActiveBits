import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import {
  isLatestStudentSnapshotRequest,
  normalizeStudentSessionSnapshot,
  resolveObservedRunRevision,
  selectStudentSessionSnapshot,
  shouldApplyStudentSessionSnapshot,
  useResonanceSession,
} from './useResonanceSession.js'
import type { StudentSessionSnapshot } from '../../shared/types.js'

;(globalThis as { React?: typeof React }).React = React

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code?: number }) => void) | null = null
  readyState = 1

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(): void {}

  close(): void {
    this.readyState = 3
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

function installWsTestEnvironment(): () => void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
  })

  const keys = ['window', 'document', 'navigator', 'WebSocket', 'fetch'] as const
  const descriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of keys) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket })
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url: string) => {
      const sessionId = /\/api\/resonance\/([^/]+)\/state/.exec(url)?.[1] ?? 'unknown'
      return {
        ok: true,
        json: async () => ({ sessionId, activeQuestionIds: [] }),
      }
    },
  })

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

void test('normalizeStudentSessionSnapshot rejects array submittedAnswers payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    submittedAnswers: ['not', 'a', 'record'],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.submittedAnswers, {})
})

void test('normalizeStudentSessionSnapshot keeps object submittedAnswers payloads', () => {
  const result = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    submittedAnswers: {
      q1: {
        type: 'free-response',
        text: 'answer',
      },
    },
  })

  assert.ok(result)
  assert.deepEqual(result.submittedAnswers, {
    q1: {
      type: 'free-response',
      text: 'answer',
    },
  })
  assert.equal(result.selfPacedMode, false)
})

void test('normalizeStudentSessionSnapshot preserves server-seeded draft generations for a reload', () => {
  const result = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    draftGenerations: { q1: 4, malformed: -1 },
  })
  assert.ok(result)
  assert.deepEqual(result.draftGenerations, { q1: 4 })
})

void test('normalizeStudentSessionSnapshot keeps selfPacedMode when provided', () => {
  const result = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    selfPacedMode: true,
  })

  assert.ok(result)
  assert.equal(result.selfPacedMode, true)
})

void test('shouldApplyStudentSessionSnapshot rejects a delayed older run even when active questions differ', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
  })
  const delayed = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q2'],
    activeQuestionRunStartedAt: 1_000,
  })
  const newer = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 3_000,
  })

  assert.ok(current)
  assert.ok(delayed)
  assert.ok(newer)
  assert.equal(shouldApplyStudentSessionSnapshot(current, delayed), false)
  assert.equal(shouldApplyStudentSessionSnapshot(current, newer), true)
})

void test('shouldApplyStudentSessionSnapshot rejects an older revision when two runs share a start timestamp', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
    activeQuestionRunRevision: 2,
  })
  const delayed = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
    activeQuestionRunRevision: 1,
  })

  assert.ok(current)
  assert.ok(delayed)
  assert.equal(shouldApplyStudentSessionSnapshot(current, delayed), false)
})

void test('shouldApplyStudentSessionSnapshot rejects a delayed active legacy snapshot after an explicit revision', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 1_000,
    activeQuestionRunRevision: 2,
  })
  const delayedLegacy = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q2'],
    activeQuestionRunStartedAt: 2_000,
  })

  assert.ok(current)
  assert.ok(delayedLegacy)
  assert.equal(delayedLegacy.activeQuestionRunRevision, null)
  assert.equal(shouldApplyStudentSessionSnapshot(current, delayedLegacy, 2), false)
})

void test('shouldApplyStudentSessionSnapshot accepts a self-paced fallback that reflects the most recent live run', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 1_000,
    activeQuestionRunRevision: 2,
  })
  const selfPacedFallback = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    selfPacedMode: true,
    activeQuestionIds: ['q1', 'q2'],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 2,
  })

  assert.ok(current)
  assert.ok(selfPacedFallback)
  assert.equal(shouldApplyStudentSessionSnapshot(current, selfPacedFallback, 2), true)
})

void test('shouldApplyStudentSessionSnapshot rejects a self-paced-shaped snapshot from before the observed live run', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 1_000,
    activeQuestionRunRevision: 2,
  })
  const staleFallback = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    selfPacedMode: true,
    activeQuestionIds: ['q1', 'q2'],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 1,
  })

  assert.ok(current)
  assert.ok(staleFallback)
  assert.equal(shouldApplyStudentSessionSnapshot(current, staleFallback, 2), false)
})

void test('shouldApplyStudentSessionSnapshot rejects a delayed idle snapshot from before a newer run already started', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q2'],
    activeQuestionRunStartedAt: 2_000,
    activeQuestionRunRevision: 2,
  })
  const delayedIdle = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 1,
  })

  assert.ok(current)
  assert.ok(delayedIdle)
  assert.equal(shouldApplyStudentSessionSnapshot(current, delayedIdle, 2), false)
})

void test('shouldApplyStudentSessionSnapshot accepts a legitimate no-active-question state after a live run', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
  })
  const noActiveQuestion = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
  })

  assert.ok(current)
  assert.ok(noActiveQuestion)
  assert.equal(shouldApplyStudentSessionSnapshot(current, noActiveQuestion), true)
})

void test('shouldApplyStudentSessionSnapshot accepts an idle snapshot that reflects the observed run ending', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
    activeQuestionRunRevision: 2,
  })
  const idleAfterRun = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 2,
  })

  assert.ok(current)
  assert.ok(idleAfterRun)
  assert.equal(shouldApplyStudentSessionSnapshot(current, idleAfterRun, 2), true)
})

void test('shouldApplyStudentSessionSnapshot rejects a delayed live snapshot from the run that just ended, even at the same revision', () => {
  // The idle snapshot below is itself the acceptance that run 2 just ended
  // (see the "reflects the observed run ending" test above). A live-shaped
  // candidate that still reports revision 2 isn't a new activation — it's a
  // message queued before that ending was observed — because a genuine next
  // activation always gets a strictly higher revision than any prior one
  // (see nextActiveQuestionRunRevision on the server). Only `>` a legitimate
  // reactivation, not `>=`, distinguishes it from this stale duplicate.
  const idleAfterRun = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 2,
  })
  const delayedSameRevision = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
    activeQuestionRunRevision: 2,
  })
  const genuineNextActivation = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q2'],
    activeQuestionRunStartedAt: 3_000,
    activeQuestionRunRevision: 3,
  })

  assert.ok(idleAfterRun)
  assert.ok(delayedSameRevision)
  assert.ok(genuineNextActivation)
  assert.equal(shouldApplyStudentSessionSnapshot(idleAfterRun, delayedSameRevision, 2), false)
  assert.equal(shouldApplyStudentSessionSnapshot(idleAfterRun, genuineNextActivation, 2), true)
})

void test('resolveObservedRunRevision prefers lastActiveQuestionRunRevision over the live revision', () => {
  const idleAfterRuns = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 5,
  })
  const liveWithoutLastRevision = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 1_000,
    activeQuestionRunRevision: 3,
  })
  const neverLive = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
  })

  assert.ok(idleAfterRuns)
  assert.ok(liveWithoutLastRevision)
  assert.ok(neverLive)
  assert.equal(resolveObservedRunRevision(idleAfterRuns), 5)
  assert.equal(resolveObservedRunRevision(liveWithoutLastRevision), 3)
  assert.equal(resolveObservedRunRevision(neverLive), null)
})

void test('shouldApplyStudentSessionSnapshot seeds its watermark from an idle current snapshot instead of leaving it null', () => {
  // The client's first-ever accepted snapshot is idle, but it already
  // reflects that 5 live runs have happened (a late-joining student, or a
  // page refresh after activity that predates this client). Without seeding
  // the watermark from lastActiveQuestionRunRevision, an out-of-order
  // delivery of an earlier live run (revision 3) would otherwise be accepted
  // and restore a long-closed question.
  const idleAfterFiveRuns = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 5,
  })
  const staleEarlierLiveRun = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 1_000,
    activeQuestionRunRevision: 3,
  })
  const newerLiveRun = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q2'],
    activeQuestionRunStartedAt: 4_000,
    activeQuestionRunRevision: 6,
  })

  assert.ok(idleAfterFiveRuns)
  assert.ok(staleEarlierLiveRun)
  assert.ok(newerLiveRun)
  // No explicit watermark argument — this exercises the default parameter
  // that must seed itself from the current snapshot.
  assert.equal(shouldApplyStudentSessionSnapshot(idleAfterFiveRuns, staleEarlierLiveRun), false)
  assert.equal(shouldApplyStudentSessionSnapshot(idleAfterFiveRuns, newerLiveRun), true)
})

void test('shouldApplyStudentSessionSnapshot rejects an older live run after an idle snapshot', () => {
  const idle = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: [],
    activeQuestionRunStartedAt: null,
  })
  const delayedLiveRun = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 1_000,
  })

  assert.ok(idle)
  assert.ok(delayedLiveRun)
  assert.equal(shouldApplyStudentSessionSnapshot(idle, delayedLiveRun, 2_000), false)
})

void test('shouldApplyStudentSessionSnapshot accepts a new session with an earlier run timestamp', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
  })
  const nextSession = normalizeStudentSessionSnapshot({
    sessionId: 'session-2',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 1_000,
  })

  assert.ok(current)
  assert.ok(nextSession)
  assert.equal(shouldApplyStudentSessionSnapshot(current, nextSession), true)
})

void test('isLatestStudentSnapshotRequest accepts only the most recent fetch', () => {
  assert.equal(isLatestStudentSnapshotRequest(2, 2), true)
  assert.equal(isLatestStudentSnapshotRequest(1, 2), false)
})

void test('a rejected stale WebSocket snapshot does not invalidate a newer deferred REST response', () => {
  const current = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunStartedAt: 2_000,
  })
  const staleWebSocketSnapshot = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q2'],
    activeQuestionRunStartedAt: 1_000,
  })
  const newerRestSnapshot = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q3'],
    activeQuestionRunStartedAt: 3_000,
  })

  assert.ok(current)
  assert.ok(staleWebSocketSnapshot)
  assert.ok(newerRestSnapshot)

  let latestRequestId = 1
  const deferredRestRequestId = latestRequestId
  const staleSelection = selectStudentSessionSnapshot(current, staleWebSocketSnapshot)
  if (staleSelection.accepted) {
    latestRequestId += 1
  }

  assert.equal(staleSelection.accepted, false)
  assert.equal(isLatestStudentSnapshotRequest(deferredRestRequestId, latestRequestId), true)

  const restSelection = selectStudentSessionSnapshot(staleSelection.snapshot, newerRestSnapshot)
  assert.equal(restSelection.accepted, true)
  assert.equal(restSelection.snapshot, newerRestSnapshot)
})

void test('normalizeStudentSessionSnapshot preserves staged run state and hidden MCQ choices', () => {
  const result = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    presentationMode: 'staged',
    stagedRun: {
      questionIds: ['q1', 'q2'],
      currentQuestionId: 'q1',
      currentIndex: 0,
      choicesRevealed: false,
      completedQuestionIds: [],
    },
    activeQuestions: [
      {
        id: 'q1',
        type: 'multiple-choice',
        text: 'Think first',
        order: 0,
        options: [],
        selectionMode: 'single',
        choicesRevealed: false,
      },
    ],
  })

  assert.ok(result)
  assert.equal(result.presentationMode, 'staged')
  assert.deepEqual(result.stagedRun?.questionIds, ['q1', 'q2'])
  const question = result.activeQuestion
  assert.equal(question?.type, 'multiple-choice')
  assert.deepEqual(question?.type === 'multiple-choice' ? question.options : null, [])
  assert.equal(question?.type === 'multiple-choice' ? question.choicesRevealed : null, false)
})

void test('normalizeStudentSessionSnapshot filters malformed activeQuestions and revealedQuestions entries', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    activeQuestions: [
      null,
      { id: 'q1', type: 'free-response', text: 'Prompt', order: 0 },
      { id: 123, type: 'free-response', text: 'Bad', order: 1 },
    ],
    revealedQuestions: [
      { id: 'q2', type: 'multiple-choice', text: 'Pick one', order: 1, options: [{ id: 'a', text: 'A' }] },
      { id: 'q3', type: 'multiple-choice', text: 'Broken', order: 2, options: [null] },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.activeQuestions.map((question) => question.id), ['q1'])
  assert.equal(result.activeQuestion?.id, 'q1')
  assert.deepEqual(result.activeQuestionIds, ['q1'])
  assert.deepEqual(result.revealedQuestions.map((question) => question.id), ['q2'])
  assert.equal(result.revealedQuestions[0]?.type, 'multiple-choice')
  assert.equal(result.revealedQuestions[0]?.type === 'multiple-choice' ? result.revealedQuestions[0].selectionMode : null, 'single')
})

void test('normalizeStudentSessionSnapshot ignores malformed fallback activeQuestion payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    activeQuestion: { id: null, type: 'free-response', text: 'Prompt', order: 0 },
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.equal(result.activeQuestion, null)
  assert.deepEqual(result.activeQuestions, [])
  assert.deepEqual(result.activeQuestionIds, [])
})

void test('normalizeStudentSessionSnapshot filters malformed reveals and reviewedResponses entries', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: ['a'],
        sharedResponses: [
          {
            id: 'shared-1',
            questionId: 'q1',
            answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
            sharedAt: 100,
            instructorEmoji: null,
            reactions: {},
          },
        ],
      },
      {
        questionId: 'q2',
        sharedAt: 'later',
        correctOptionIds: ['b'],
        sharedResponses: [],
      },
    ],
    reviewedResponses: [
      {
        question: { id: 'q3', type: 'free-response', text: 'Prompt', order: 0 },
        answer: { type: 'free-response', text: 'answer' },
        submittedAt: 200,
        instructorEmoji: 'star',
      },
      {
        question: null,
        answer: { type: 'free-response', text: 'bad' },
        submittedAt: 300,
        instructorEmoji: 'star',
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals.map((reveal) => reveal.questionId), ['q1'])
  assert.deepEqual(result.reviewedResponses.map((response) => response.question.id), ['q3'])
})

void test('normalizeStudentSessionSnapshot keeps valid reveal viewerResponse payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: ['a'],
        sharedResponses: [],
        viewerResponse: {
          answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
          submittedAt: 90,
          instructorEmoji: '🔥',
          isShared: true,
        },
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals[0]?.viewerResponse, {
    answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
    submittedAt: 90,
    instructorEmoji: '🔥',
    isShared: true,
  })
})

void test('normalizeStudentSessionSnapshot trims and deduplicates multiple-choice answer option ids', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: ['a'],
        sharedResponses: [
          {
            id: 'shared-1',
            questionId: 'q1',
            answer: { type: 'multiple-choice', selectedOptionIds: [' a ', 'a', 'b '] },
            sharedAt: 100,
            instructorEmoji: null,
            reactions: {},
          },
        ],
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals[0]?.sharedResponses[0]?.answer, {
    type: 'multiple-choice',
    selectedOptionIds: ['a', 'b'],
  })
})

void test('normalizeStudentSessionSnapshot sanitizes shared response reactions', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: null,
        sharedResponses: [
          {
            id: 'shared-1',
            questionId: 'q1',
            answer: { type: 'free-response', text: 'answer' },
            sharedAt: 100,
            instructorEmoji: null,
            reactions: {
              '👍': 2,
              '🔥': 0,
              bogus: 5,
              '💡': Number.NaN,
              '😮': -1,
              '❤️': '3',
            },
          },
        ],
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals[0]?.sharedResponses[0]?.reactions, {
    '👍': 2,
    '🔥': 0,
  })
})

void test('normalizeStudentSessionSnapshot drops malformed reveal viewerResponse payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: ['a'],
        sharedResponses: [],
        viewerResponse: {
          answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
          submittedAt: '90',
          instructorEmoji: '🔥',
          isShared: true,
        },
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals, [])
})

void test('a queued message from a prior student identity cannot leak into the new identity', async () => {
  const restore = installWsTestEnvironment()
  const { act, render } = await import('@testing-library/react')

  try {
    const captured: { snapshot: StudentSessionSnapshot | null } = { snapshot: null }
    function Probe({ sessionId, studentId }: { sessionId: string; studentId: string }) {
      const { snapshot } = useResonanceSession(sessionId, studentId)
      captured.snapshot = snapshot
      return null
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(React.createElement(Probe, { sessionId: 'session-A', studentId: 'student-A' }))
    })
    assert.equal(FakeWebSocket.instances.length, 1, 'exactly one socket opens for the first identity')
    const staleSocket = FakeWebSocket.instances[0]!

    // Switching identity (e.g. a new student registering in the same tab) tears
    // down the old effect and opens a second socket for the new identity.
    await act(async () => {
      rendered.rerender(React.createElement(Probe, { sessionId: 'session-B', studentId: 'student-B' }))
    })
    assert.equal(FakeWebSocket.instances.length, 2, 'the identity change opens a second socket')

    console.info('[TEST] delivering a message queued on the old socket after the identity changed; it must be ignored')
    await act(async () => {
      staleSocket.emitMessage({
        type: 'resonance:session-state',
        payload: { sessionId: 'session-A', activeQuestionIds: ['session-A-secret-question'] },
      })
    })
    assert.notDeepEqual(captured.snapshot?.activeQuestionIds, ['session-A-secret-question'])

    const currentSocket = FakeWebSocket.instances[1]!
    await act(async () => {
      currentSocket.emitMessage({
        type: 'resonance:session-state',
        payload: { sessionId: 'session-B', activeQuestionIds: ['session-B-question'] },
      })
    })
    assert.deepEqual(captured.snapshot?.activeQuestionIds, ['session-B-question'])

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('Strict Mode opens only the retained student socket', async () => {
  const restore = installWsTestEnvironment()
  const { act, render, waitFor } = await import('@testing-library/react')
  try {
    function Probe() { useResonanceSession('session-1', 'student-1'); return null }
    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(React.createElement(React.StrictMode, null, React.createElement(Probe)))
      await Promise.resolve()
    })
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    await act(async () => { rendered.unmount() })
  } finally {
    restore()
  }
})

void test('saveDraft resolves false instead of rejecting when the socket throws synchronously on send', async () => {
  // The socket can close between the readyState check and the send call
  // below it. QuestionView only attaches `.then` to this Promise (no
  // `.catch`), so an uncaught rejection here would silently drop the draft
  // instead of marking/reconciling it as unconfirmed.
  const restore = installWsTestEnvironment()
  const { act, render } = await import('@testing-library/react')

  try {
    const captured: { saveDraft: ((payload: Record<string, unknown>) => Promise<boolean>) | null } = { saveDraft: null }
    function Probe({ sessionId, studentId }: { sessionId: string; studentId: string }) {
      const { saveDraft } = useResonanceSession(sessionId, studentId)
      captured.saveDraft = saveDraft
      return null
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(React.createElement(Probe, { sessionId: 'session-A', studentId: 'student-A' }))
    })
    const socket = FakeWebSocket.instances[0]!
    socket.send = () => {
      throw new Error('socket closed mid-send')
    }

    console.info('[TEST] saveDraft must not reject when the underlying send throws synchronously')
    let result: boolean | undefined
    let rejected = false
    await act(async () => {
      try {
        result = await captured.saveDraft?.({ questionId: 'q1', answer: null })
      } catch {
        rejected = true
      }
    })

    assert.equal(rejected, false)
    assert.equal(result, false)

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('saveDraft retries a failed send after reconnecting within the same active run', async () => {
  const restore = installWsTestEnvironment()
  const { act, render, waitFor } = await import('@testing-library/react')

  try {
    const captured: { saveDraft: ((payload: Record<string, unknown>) => Promise<boolean>) | null } = { saveDraft: null }
    function Probe() {
      const { saveDraft } = useResonanceSession('session-1', 'student-1')
      captured.saveDraft = saveDraft
      return null
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(React.createElement(Probe))
      await Promise.resolve()
    })
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const firstSocket = FakeWebSocket.instances[0]!
    firstSocket.emitMessage({
      type: 'resonance:session-state',
      payload: {
        sessionId: 'session-1',
        activeQuestionIds: ['q1'],
        activeQuestionRunRevision: 3,
        activeQuestionDeadlineAt: Date.now() + 10_000,
      },
    })
    firstSocket.send = () => {
      throw new Error('socket closed mid-send')
    }

    console.info('[TEST] a failed draft send is expected to retry after the socket reconnects')
    await act(async () => {
      assert.equal(await captured.saveDraft?.({
        studentId: 'student-1',
        questionId: 'q1',
        activeQuestionRunRevision: 3,
        answer: { type: 'free-response', text: 'Retry me' },
      }), false)
    })

    firstSocket.onclose?.({})
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 2))
    const secondSocket = FakeWebSocket.instances[1]!
    const sent: unknown[] = []
    secondSocket.send = (message?: unknown) => { sent.push(message) }
    secondSocket.onopen?.()

    await waitFor(() => assert.equal(sent.length, 1))
    const sentMessage = JSON.parse(String(sent[0])) as { payload?: { draftId?: string; answer?: { text?: string } } }
    assert.equal(sentMessage.payload?.answer?.text, 'Retry me')
    assert.equal(typeof sentMessage.payload?.draftId, 'string')
    secondSocket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId: sentMessage.payload?.draftId } })

    await act(async () => { rendered.unmount() })
  } finally {
    restore()
  }
})

void test('saveDraft retries an acknowledgement timeout after reconnecting within the same active run', async () => {
  const restore = installWsTestEnvironment()
  const { act, render, waitFor } = await import('@testing-library/react')

  try {
    const captured: { saveDraft: ((payload: Record<string, unknown>) => Promise<boolean>) | null } = { saveDraft: null }
    function Probe() {
      const { saveDraft } = useResonanceSession('session-1', 'student-1')
      captured.saveDraft = saveDraft
      return null
    }
    let rendered!: ReturnType<typeof render>
    await act(async () => { rendered = render(React.createElement(Probe)); await Promise.resolve() })
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const firstSocket = FakeWebSocket.instances[0]!
    firstSocket.emitMessage({ type: 'resonance:session-state', payload: {
      sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 3, activeQuestionDeadlineAt: Date.now() + 10_000,
    } })

    console.info('[TEST] an unacknowledged draft is expected to retry after the socket reconnects')
    await act(async () => {
      assert.equal(await captured.saveDraft?.({ studentId: 'student-1', questionId: 'q1', activeQuestionRunRevision: 3, draftGeneration: 1, answer: { type: 'free-response', text: 'Retry after timeout' } }), false)
    })
    firstSocket.onclose?.({})
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 2))
    const secondSocket = FakeWebSocket.instances[1]!
    const sent: unknown[] = []
    secondSocket.send = (message?: unknown) => { sent.push(message) }
    secondSocket.onopen?.()
    await waitFor(() => assert.equal(sent.length, 1))
    assert.equal((JSON.parse(String(sent[0])) as { payload: { answer: { text: string } } }).payload.answer.text, 'Retry after timeout')
    await act(async () => { rendered.unmount() })
  } finally { restore() }
})

void test('a direct save that succeeds clears an older queued reconnect retry for the same key', async () => {
  // The ACK for a normal saveDraft call (pendingDraftSavesRef) and the ACK
  // for a queued reconnect retry (retryDraftSavesRef) are handled by separate
  // branches. Only the retry branch cleaned up queuedDraftRetriesRef — a
  // direct save's ACK left a stale queued entry behind, so an unrelated
  // later reconnect would resend an already-superseded draft.
  const restore = installWsTestEnvironment()
  const { act, render, waitFor } = await import('@testing-library/react')

  try {
    const captured: { saveDraft: ((payload: Record<string, unknown>) => Promise<boolean>) | null } = { saveDraft: null }
    function Probe() {
      const { saveDraft } = useResonanceSession('session-1', 'student-1')
      captured.saveDraft = saveDraft
      return null
    }
    let rendered!: ReturnType<typeof render>
    await act(async () => { rendered = render(React.createElement(Probe)); await Promise.resolve() })
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 1))
    const firstSocket = FakeWebSocket.instances[0]!
    firstSocket.emitMessage({ type: 'resonance:session-state', payload: {
      sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 3, activeQuestionDeadlineAt: Date.now() + 30_000,
    } })

    console.info('[TEST] an unacknowledged generation-1 draft queues a reconnect retry after timing out')
    await act(async () => {
      assert.equal(await captured.saveDraft?.({
        studentId: 'student-1', questionId: 'q1', activeQuestionRunRevision: 3,
        draftGeneration: 1, answer: { type: 'free-response', text: 'Generation one, never acked' },
      }), false)
    })

    console.info('[TEST] a later direct save for the same key is acknowledged and must clear that queued retry')
    const sentAfterSuccess: unknown[] = []
    firstSocket.send = (message?: unknown) => { sentAfterSuccess.push(message) }
    const savePromise = captured.saveDraft?.({
      studentId: 'student-1', questionId: 'q1', activeQuestionRunRevision: 3,
      draftGeneration: 2, answer: { type: 'free-response', text: 'Generation two, acked directly' },
    })
    await waitFor(() => assert.equal(sentAfterSuccess.length, 1))
    const directDraftId = (JSON.parse(String(sentAfterSuccess[0])) as { payload: { draftId: string } }).payload.draftId
    await act(async () => {
      firstSocket.emitMessage({ type: 'resonance:draft-saved', payload: { draftId: directDraftId } })
      assert.equal(await savePromise, true)
    })

    // Reconnect: if the generation-1 timeout's queued retry survived the
    // generation-2 direct ACK above, this flush would resend it here.
    firstSocket.onclose?.({})
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    await waitFor(() => assert.equal(FakeWebSocket.instances.length, 2))
    const secondSocket = FakeWebSocket.instances[1]!
    const sentAfterReconnect: unknown[] = []
    secondSocket.send = (message?: unknown) => { sentAfterReconnect.push(message) }
    secondSocket.onopen?.()

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.deepEqual(sentAfterReconnect, [])

    await act(async () => { rendered.unmount() })
  } finally { restore() }
})

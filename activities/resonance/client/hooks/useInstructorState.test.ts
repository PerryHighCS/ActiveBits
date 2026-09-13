import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { normalizeInstructorStateSnapshot, useInstructorState } from './useInstructorState.js'
import { resolveObservedInstructorRunRevision, shouldApplyInstructorSnapshot } from './useInstructorState.js'
import type { InstructorStateSnapshot } from './useInstructorState.js'

;(globalThis as { React?: typeof React }).React = React

function buildInstructorSnapshot(overrides: Partial<InstructorStateSnapshot>): InstructorStateSnapshot {
  const base = normalizeInstructorStateSnapshot({ sessionId: 'session-1' })
  assert.ok(base)
  return { ...base, ...overrides }
}

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

function installInstructorWsTestEnvironment(
  fetchImpl: (url: string) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>,
): () => void {
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
    value: (url: string) => fetchImpl(url),
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

void test('normalizeInstructorStateSnapshot rejects array annotations and responseOrderOverrides', () => {
  const result = normalizeInstructorStateSnapshot(({
    sessionId: 'session-1',
    annotations: ['not', 'a', 'record'],
    responseOrderOverrides: ['also', 'not', 'a', 'record'],
  }) as unknown as Partial<InstructorStateSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.annotations, {})
  assert.deepEqual(result.responseOrderOverrides, {})
})

void test('normalizeInstructorStateSnapshot preserves record annotations and responseOrderOverrides', () => {
  const result = normalizeInstructorStateSnapshot({
    sessionId: 'session-1',
    annotations: {
      responseA: {
        starred: true,
        flagged: false,
        emoji: null,
      },
    },
    responseOrderOverrides: {
      q1: ['responseA'],
    },
  })

  assert.ok(result)
  assert.deepEqual(result.annotations, {
    responseA: {
      starred: true,
      flagged: false,
      emoji: null,
    },
  })
  assert.deepEqual(result.responseOrderOverrides, {
    q1: ['responseA'],
  })
})

void test('normalizeInstructorStateSnapshot filters malformed responses and progress entries', () => {
  const result = normalizeInstructorStateSnapshot(({
    sessionId: 'session-1',
    responses: [
      null,
      {
        id: 'response-1',
        questionId: 'q1',
        studentId: 'student-1',
        studentName: 'Ada',
        submittedAt: 123,
        answer: { type: 'free-response', text: 'answer' },
      },
      {
        id: 'response-2',
        questionId: 'q2',
        studentId: 5,
        studentName: 'Broken',
        submittedAt: 456,
        answer: { type: 'free-response', text: 'bad' },
      },
    ],
    progress: [
      null,
      {
        questionId: 'q1',
        studentId: 'student-1',
        studentName: 'Ada',
        updatedAt: 999,
        status: 'submitted',
        answer: { type: 'free-response', text: 'stale duplicate' },
        responseId: 'response-1',
      },
      {
        questionId: 'q2',
        studentId: 'student-2',
        studentName: 'Grace',
        updatedAt: 1000,
        status: 'working',
        answer: null,
        responseId: null,
      },
      {
        questionId: 'q3',
        studentId: 'student-3',
        studentName: 'Invalid',
        updatedAt: 'later',
        status: 'working',
      },
    ],
  }) as unknown as Partial<InstructorStateSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.responses.map((response) => response.id), ['response-1'])
  assert.deepEqual(
    result.progress.map((entry) => ({ questionId: entry.questionId, studentId: entry.studentId, status: entry.status })),
    [
      { questionId: 'q1', studentId: 'student-1', status: 'submitted' },
      { questionId: 'q2', studentId: 'student-2', status: 'working' },
    ],
  )
})

void test('normalizeInstructorStateSnapshot prefers explicit working progress over a retained response for the same student and question', () => {
  const result = normalizeInstructorStateSnapshot({
    sessionId: 'session-1',
    responses: [{
      id: 'response-1', questionId: 'q1', studentId: 'student-1', studentName: 'Ada', submittedAt: 1_000,
      answer: { type: 'free-response', text: 'Original submitted answer' },
    }],
    progress: [{
      questionId: 'q1', studentId: 'student-1', studentName: 'Ada', updatedAt: 2_000,
      status: 'working', answer: { type: 'free-response', text: 'Newer revisit draft' }, responseId: null,
    }],
  })

  assert.ok(result)
  assert.deepEqual(result.progress, [{
    questionId: 'q1', studentId: 'student-1', studentName: 'Ada', updatedAt: 2_000,
    status: 'working', answer: { type: 'free-response', text: 'Newer revisit draft' }, responseId: null,
  }])
  assert.equal(result.responses[0]?.id, 'response-1', 'the retained response remains available separately')
})

void test('normalizeInstructorStateSnapshot filters malformed reveal entries', () => {
  const result = normalizeInstructorStateSnapshot(({
    sessionId: 'session-1',
    reveals: [
      null,
      {
        questionId: 'q1',
        sharedAt: 123,
        correctOptionIds: ['a'],
        sharedResponses: [],
      },
      {
        questionId: 'q2',
        sharedAt: 'later',
        correctOptionIds: ['b'],
        sharedResponses: [],
      },
      {
        questionId: 'q3',
        sharedAt: 456,
        correctOptionIds: 5,
        sharedResponses: [],
      },
    ],
  }) as unknown as Partial<InstructorStateSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals.map((reveal) => reveal.questionId), ['q1'])
})

void test('resolveObservedInstructorRunRevision prefers lastActiveQuestionRunRevision over the live revision', () => {
  const endedRun = buildInstructorSnapshot({
    activeQuestionIds: [],
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 2,
  })
  const liveWithoutLastRevision = buildInstructorSnapshot({
    activeQuestionIds: ['q1'],
    activeQuestionRunRevision: 3,
    lastActiveQuestionRunRevision: null,
  })

  assert.equal(resolveObservedInstructorRunRevision(endedRun), 2)
  assert.equal(resolveObservedInstructorRunRevision(liveWithoutLastRevision), 3)
})

void test('shouldApplyInstructorSnapshot rejects a delayed pre-timeout REST snapshot that arrives after the WS-pushed finalization', () => {
  // A GET /responses request begun before a deadline finalizes can resolve
  // after the resonance:instructor-state broadcast for that finalization.
  // Without ordering, applying it unconditionally resurrects the ended
  // question/progress, and since REST polling is stopped while the socket is
  // open, that stale view can persist indefinitely.
  const liveBeforeTimeout = buildInstructorSnapshot({
    activeQuestionIds: ['q1'],
    activeQuestionRunRevision: 2,
    lastActiveQuestionRunRevision: 2,
  })
  const finalizedAfterTimeout = buildInstructorSnapshot({
    activeQuestionIds: [],
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 2,
  })

  assert.equal(shouldApplyInstructorSnapshot(liveBeforeTimeout, finalizedAfterTimeout, 2), true)
  // The delayed REST response for the pre-timeout state arrives next — it
  // must not be allowed to undo the finalization just applied above.
  assert.equal(shouldApplyInstructorSnapshot(finalizedAfterTimeout, liveBeforeTimeout, 2), false)
})

void test('shouldApplyInstructorSnapshot rejects a delayed live snapshot from the run that just ended, even at the same revision', () => {
  // A legitimate next activation always gets a strictly higher revision than
  // any prior one (see nextActiveQuestionRunRevision on the server), so once
  // an ended-run snapshot at revision 2 has been applied, a live-shaped
  // candidate still reporting revision 2 is a stale duplicate, not a new run.
  const endedAtTwo = buildInstructorSnapshot({
    activeQuestionIds: [],
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: 2,
  })
  const delayedSameRevision = buildInstructorSnapshot({
    activeQuestionIds: ['q1'],
    activeQuestionRunRevision: 2,
    lastActiveQuestionRunRevision: 2,
  })
  const genuineNextActivation = buildInstructorSnapshot({
    activeQuestionIds: ['q2'],
    activeQuestionRunRevision: 3,
    lastActiveQuestionRunRevision: 3,
  })

  assert.equal(shouldApplyInstructorSnapshot(endedAtTwo, delayedSameRevision, 2), false)
  assert.equal(shouldApplyInstructorSnapshot(endedAtTwo, genuineNextActivation, 2), true)
})

void test('shouldApplyInstructorSnapshot accepts same-revision updates while a run is still live', () => {
  const live = buildInstructorSnapshot({
    activeQuestionIds: ['q1'],
    activeQuestionRunRevision: 2,
    lastActiveQuestionRunRevision: 2,
  })
  const updatedProgress = buildInstructorSnapshot({
    activeQuestionIds: ['q1'],
    activeQuestionRunRevision: 2,
    lastActiveQuestionRunRevision: 2,
    progress: [{
      questionId: 'q1',
      studentId: 'student-1',
      studentName: 'Ada',
      updatedAt: 1_000,
      status: 'working',
      answer: null,
      responseId: null,
    }],
  })

  assert.equal(shouldApplyInstructorSnapshot(live, updatedProgress, 2), true)
})

void test('shouldApplyInstructorSnapshot always accepts a different session', () => {
  const current = buildInstructorSnapshot({
    sessionId: 'session-1',
    activeQuestionIds: ['q1'],
    activeQuestionRunRevision: 5,
    lastActiveQuestionRunRevision: 5,
  })
  const otherSession = buildInstructorSnapshot({
    sessionId: 'session-2',
    activeQuestionIds: [],
    activeQuestionRunRevision: null,
    lastActiveQuestionRunRevision: null,
  })

  assert.equal(shouldApplyInstructorSnapshot(current, otherSession), true)
})

void test('a queued message from a prior instructor session cannot leak into the new session', async () => {
  const restore = installInstructorWsTestEnvironment(async (url) => {
    const sessionId = /\/api\/resonance\/([^/]+)\/responses/.exec(url)?.[1] ?? 'unknown'
    return { ok: true, json: async () => ({ sessionId, activeQuestionIds: [] }) }
  })
  const { act, render } = await import('@testing-library/react')

  try {
    const captured: { snapshot: InstructorStateSnapshot | null } = { snapshot: null }
    function Probe({ sessionId, passcode }: { sessionId: string; passcode: string }) {
      const { snapshot } = useInstructorState(sessionId, passcode)
      captured.snapshot = snapshot
      return null
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(React.createElement(Probe, { sessionId: 'session-A', passcode: 'PASS-A' }))
    })
    assert.equal(FakeWebSocket.instances.length, 1, 'exactly one socket opens for the first session')
    const staleSocket = FakeWebSocket.instances[0]!

    // Switching to a different session/passcode tears down the old effect and
    // opens a second socket for the new one.
    await act(async () => {
      rendered.rerender(React.createElement(Probe, { sessionId: 'session-B', passcode: 'PASS-B' }))
    })
    assert.equal(FakeWebSocket.instances.length, 2, 'the session change opens a second socket')

    console.info('[TEST] delivering a message queued on the old instructor socket after the session changed; it must be ignored')
    await act(async () => {
      staleSocket.emitMessage({
        type: 'resonance:instructor-state',
        payload: { sessionId: 'session-A', activeQuestionIds: ['session-A-secret-question'] },
      })
    })
    assert.notDeepEqual(captured.snapshot?.activeQuestionIds, ['session-A-secret-question'])

    const currentSocket = FakeWebSocket.instances[1]!
    await act(async () => {
      currentSocket.emitMessage({
        type: 'resonance:instructor-state',
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

void test('Strict Mode opens only the retained instructor socket', async () => {
  const restore = installInstructorWsTestEnvironment(async () => ({ ok: true, json: async () => ({ sessionId: 'session-1', activeQuestionIds: [] }) }))
  const { act, render, waitFor } = await import('@testing-library/react')
  try {
    function Probe() { useInstructorState('session-1', 'PASS'); return null }
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

void test('switching instructor sessions resets the run-ordering watermark before the next session activates', async () => {
  const restore = installInstructorWsTestEnvironment(async (url) => {
    const sessionId = /\/api\/resonance\/([^/]+)\/responses/.exec(url)?.[1] ?? 'unknown'
    if (sessionId === 'session-A') {
      return {
        ok: true,
        json: async () => ({
          sessionId,
          activeQuestionIds: ['q-old'],
          activeQuestionRunRevision: 5,
          lastActiveQuestionRunRevision: 5,
        }),
      }
    }
    return {
      ok: true,
      json: async () => ({
        sessionId,
        activeQuestionIds: [],
        activeQuestionRunRevision: null,
        lastActiveQuestionRunRevision: null,
      }),
    }
  })
  const { act, render, waitFor } = await import('@testing-library/react')

  try {
    const captured: { snapshot: InstructorStateSnapshot | null } = { snapshot: null }
    function Probe({ sessionId, passcode }: { sessionId: string; passcode: string }) {
      const { snapshot } = useInstructorState(sessionId, passcode)
      captured.snapshot = snapshot
      return null
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(React.createElement(Probe, { sessionId: 'session-A', passcode: 'PASS-A' }))
    })
    await waitFor(() => assert.equal(captured.snapshot?.activeQuestionRunRevision, 5))

    await act(async () => {
      rendered.rerender(React.createElement(Probe, { sessionId: 'session-B', passcode: 'PASS-B' }))
    })
    await waitFor(() => assert.equal(captured.snapshot?.sessionId, 'session-B'))
    assert.equal(captured.snapshot?.activeQuestionRunRevision, null)

    const currentSocket = FakeWebSocket.instances[1]!
    await act(async () => {
      currentSocket.emitMessage({
        type: 'resonance:instructor-state',
        payload: {
          sessionId: 'session-B',
          activeQuestionIds: ['q-new'],
          activeQuestionRunRevision: 1,
          lastActiveQuestionRunRevision: 1,
        },
      })
    })
    assert.equal(captured.snapshot?.activeQuestionRunRevision, 1)
    assert.deepEqual(captured.snapshot?.activeQuestionIds, ['q-new'])

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

void test('a same-run REST response arriving after a newer WebSocket push does not overwrite it', async () => {
  const pendingFetches: Array<{ resolve: (value: { ok: boolean; json(): Promise<unknown> }) => void }> = []
  const restore = installInstructorWsTestEnvironment((_url) => new Promise((resolve) => {
    pendingFetches.push({ resolve })
  }))
  const { act, render, waitFor } = await import('@testing-library/react')

  try {
    const captured: { snapshot: InstructorStateSnapshot | null } = { snapshot: null }
    function Probe({ sessionId, passcode }: { sessionId: string; passcode: string }) {
      const { snapshot } = useInstructorState(sessionId, passcode)
      captured.snapshot = snapshot
      return null
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(React.createElement(Probe, { sessionId: 'session-1', passcode: 'PASS' }))
    })

    // The initial (mount) REST fetch is left in flight deliberately.
    await waitFor(() => assert.equal(pendingFetches.length, 1))
    const socket = FakeWebSocket.instances[0]!

    // A newer WebSocket push for run revision 2 lands first.
    await act(async () => {
      socket.emitMessage({
        type: 'resonance:instructor-state',
        payload: {
          sessionId: 'session-1',
          activeQuestionIds: ['q1'],
          activeQuestionRunRevision: 2,
          lastActiveQuestionRunRevision: 2,
          responses: [{
            id: 'r-ws',
            questionId: 'q1',
            studentId: 'student-1',
            studentName: 'Ada',
            submittedAt: 2_000,
            answer: { type: 'free-response', text: 'From WS' },
          }],
        },
      })
    })
    assert.equal(captured.snapshot?.responses[0]?.id, 'r-ws')

    console.info('[TEST] a stale pre-timeout REST response for the same run revision resolves after a newer WebSocket push; it must not overwrite it')
    await act(async () => {
      pendingFetches[0]!.resolve({
        ok: true,
        json: async () => ({
          sessionId: 'session-1',
          activeQuestionIds: ['q1'],
          activeQuestionRunRevision: 2,
          lastActiveQuestionRunRevision: 2,
          responses: [{
            id: 'r-rest',
            questionId: 'q1',
            studentId: 'student-1',
            studentName: 'Ada',
            submittedAt: 1_000,
            answer: { type: 'free-response', text: 'From REST (stale)' },
          }],
        }),
      })
    })

    assert.equal(
      captured.snapshot?.responses[0]?.id,
      'r-ws',
      'the stale same-revision REST response must not overwrite the newer WebSocket push',
    )

    await act(async () => {
      rendered.unmount()
    })
  } finally {
    restore()
  }
})

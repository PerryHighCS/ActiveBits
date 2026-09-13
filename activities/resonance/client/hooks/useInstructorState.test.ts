import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeInstructorStateSnapshot } from './useInstructorState.js'
import { resolveObservedInstructorRunRevision, shouldApplyInstructorSnapshot } from './useInstructorState.js'
import type { InstructorStateSnapshot } from './useInstructorState.js'

function buildInstructorSnapshot(overrides: Partial<InstructorStateSnapshot>): InstructorStateSnapshot {
  const base = normalizeInstructorStateSnapshot({ sessionId: 'session-1' })
  assert.ok(base)
  return { ...base, ...overrides }
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

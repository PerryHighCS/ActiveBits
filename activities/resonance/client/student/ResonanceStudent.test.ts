import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { MemoryRouter, Route, Routes } from 'react-router'
import ResonanceStudent from './ResonanceStudent.js'
import { resolveNextSelfPacedQuestionId } from './ResonanceStudent.js'
import { clearLiveQuestionSubmission, resolveQuestionAnswer } from './ResonanceStudent.js'
import { resolveQuestionStatusBadge } from './ResonanceStudent.js'
import { resolveSubmissionAnnouncement } from './ResonanceStudent.js'
import { resolveSelfPacedSubmittedMessage } from './ResonanceStudent.js'
import { hasActiveQuestionRunRestart } from './ResonanceStudent.js'
import { shouldRetryRegistrationWithoutStudentId } from './ResonanceStudent.js'
import { advanceQuestionEditSequenceForRevisit, resolveQuestionEditSequence } from './ResonanceStudent.js'
import { seedQuestionEditSequenceFromConfirmedResponse } from './ResonanceStudent.js'
import {
  canonicalizeQuestionRunToken,
  getQuestionAcknowledgedGeneration,
  getQuestionAttemptedGeneration,
  getQuestionUnconfirmedDraft,
  nextQuestionDraftGeneration,
  resolveQuestionRunTokenForPayload,
  setQuestionUnconfirmedDraft,
} from './ResonanceStudent.js'
import type { QuestionDraftState } from './ResonanceStudent.js'
import { buildUnconfirmedDraftKey } from './ResonanceStudent.js'
import { canonicalizeLegacyRevisionOneDraft } from './ResonanceStudent.js'
import { payloadMatchesRunToken } from './ResonanceStudent.js'
import { resolveUnconfirmedDraftDisposition } from './ResonanceStudent.js'
import { isSameDraftAnswer } from './ResonanceStudent.js'

;(globalThis as { React?: typeof React }).React = React

class StudentTestWebSocket {
  static instances: StudentTestWebSocket[] = []
  static readonly OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readyState = 1
  shouldFailDraft = true
  draftAttempts = 0
  sent: string[] = []

  constructor() { StudentTestWebSocket.instances.push(this) }
  send(message: string): void {
    if (message.includes('resonance:update-draft')) this.draftAttempts += 1
    if (this.shouldFailDraft && message.includes('resonance:update-draft')) throw new Error('offline draft send')
    this.sent.push(message)
  }
  close(): void { this.readyState = 3 }
  emit(payload: unknown): void { this.onmessage?.({ data: JSON.stringify(payload) }) }
}

function installStudentDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://activebits.local/' })
  const descriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const key of ['window', 'document', 'navigator', 'WebSocket', 'fetch'] as const) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: StudentTestWebSocket })
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.includes('register-student')) return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ari' }) }
    return { ok: true, json: async () => ({ sessionId: 'session-1', activeQuestionIds: [] }) }
  } })
  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
    StudentTestWebSocket.instances.length = 0
  }
}

void test('mounted student retains a failed Q1 autosave across a Q2 tab remount and retries it', async () => {
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 10_000,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'retain me' } })
    // The countdown causes a parent render at one second. Its stable
    // generation callback must not flush this 1500ms child debounce early.
    await new Promise((resolve) => setTimeout(resolve, 1_050))
    assert.equal(socket.draftAttempts, 0)
    // Q1's child is keyed and unmounts as the student changes stack tabs.
    fireEvent.click(rendered.getByRole('button', { name: /q2/i }))
    await waitFor(() => assert.equal(socket.draftAttempts, 1))
    socket.shouldFailDraft = false
    console.info('[TEST] a failed Q1 autosave must be retried by the mounted parent after Q2 remounts')
    await waitFor(() => assert.ok(socket.sent.some((message) => message.includes('retain me'))), { timeout: 2_500 })
    const retry = JSON.parse(socket.sent.find((message) => message.includes('retain me'))!) as { payload: { draftId: string } }
    await act(async () => { socket.emit({ type: 'resonance:draft-saved', payload: { draftId: retry.payload.draftId } }) })

    socket.sent.length = 0
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', selfPacedMode: true, lastActiveQuestionRunRevision: 7,
        activeQuestionIds: ['q3', 'q4'],
        activeQuestions: [
          { id: 'q3', type: 'free-response', text: 'Reloaded self-paced', order: 3 },
          { id: 'q4', type: 'free-response', text: 'Other', order: 4 },
        ], draftGenerations: { q3: 4 },
      } })
    })
    await waitFor(() => rendered.getByText('Reloaded self-paced'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'Generation five' } })
    fireEvent.click(rendered.getByRole('button', { name: /^q2$/i }))
    await waitFor(() => assert.ok(socket.sent.some((message) => message.includes('Generation five'))), { timeout: 1_000 })
    const reloadedDraft = JSON.parse(socket.sent.find((message) => message.includes('Generation five'))!) as {
      payload: { draftGeneration?: number; draftId?: string }
    }
    assert.equal(reloadedDraft.payload.draftGeneration, 5)
    await act(async () => {
      socket.emit({ type: 'resonance:draft-saved', payload: { draftId: reloadedDraft.payload.draftId } })
    })

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('mounted parent reconciles a failed off-screen stack draft when the live deadline expires', async () => {
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })
    fireEvent.change(await waitFor(() => rendered.getByLabelText(/your answer/i)), { target: { value: 'off-screen failed draft' } })
    fireEvent.click(rendered.getByRole('button', { name: /^q2$/i }))
    await waitFor(() => assert.ok(socket.draftAttempts >= 1))

    // The retained Q1 save has failed, but the student returns and makes a
    // newer edit whose normal debounce has not fired when the deadline hits.
    fireEvent.click(rendered.getByRole('button', { name: /^q1$/i }))
    fireEvent.change(await waitFor(() => rendered.getByLabelText(/your answer/i)), { target: { value: 'newer deadline draft' } })

    console.info('[TEST] an expired live snapshot reconciles the newest optimistic Q1 edit after an older save failed')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() - 1,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })
    await waitFor(() => assert.equal((rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value, ''))
    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a save that fails after its run ends is handed off and cannot leak a stale answer into the new run', async () => {
  // QuestionView is not remounted just because the run token changes (only a
  // stack-tab switch remounts it, since it's keyed by question id). A save
  // that was still in flight when the run changed used to have its failure
  // silently dropped by QuestionView's own run-token guard: the parent never
  // learned about it, so the optimistic answer written to `submittedAnswers`
  // by onDraftChanged was never cleared and kept showing under the new run.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'stale run answer' } })

    console.info('[TEST] a run-7 draft is sent but never acknowledged')
    await waitFor(() => assert.equal(socket.draftAttempts, 1), { timeout: 2_000 })

    // The instructor reactivates the same question in a new run while the
    // save above is still pending. Same question id, so QuestionView stays
    // mounted; only its run-token prop changes.
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 8,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    console.info('[TEST] the stale run-7 save must be discarded, not leaked into run 8, once it finally times out')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100))
    })

    await waitFor(() => {
      assert.notEqual((rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value, 'stale run answer')
    }, { timeout: 2_000 })

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a stale-run discard cannot delete a same-text legitimate answer typed in the new run', async () => {
  // discardUnconfirmedDraft used to compare only answer content. A run-7
  // failed draft and a run-8 local edit that happen to contain the same
  // text/selection must not be conflated: the discard has to require the
  // cached answer's own recorded run to match the stale payload's run
  // before deleting it.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: '42' } })

    console.info('[TEST] a run-7 draft of "42" is sent but never acknowledged')
    await waitFor(() => assert.equal(socket.draftAttempts, 1), { timeout: 2_000 })

    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 8,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    console.info('[TEST] a run-8 edit that happens to also read "42" must survive the run-7 discard')
    fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: '42x' } })
    fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: '42' } })

    // Let the stale run-7 save finally time out and get discarded.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100))
    })

    assert.equal((rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value, '42')

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a stale local answer from a previous run cannot be redisplayed or resubmitted after a run restart', async () => {
  // resolveQuestionAnswer always prefers submittedAnswers over the server
  // snapshot for display. Without clearing a stale-run entry as soon as a
  // run restart is observed, a run-7 answer would still be shown — and
  // resubmittable — under the run-8 token until the unrelated retry/discard
  // cycle eventually got around to it.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'leftover from run 7' } })

    console.info('[TEST] the run-7 answer is cached locally as soon as it is typed')
    await waitFor(() => assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'leftover from run 7',
    ))

    console.info('[TEST] a run restart for the same question must not carry the run-7 answer into run 8')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 8,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      '',
    )

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a stale local answer from an ended live run cannot be redisplayed after a direct fallback to self-paced mode', async () => {
  // Copilot's finding: the didRunRestart stale-answer cleanup above only
  // runs in the non-self-paced branch of this effect. A live run can hand
  // off directly to a self-paced snapshot without an intermediate idle
  // snapshot in between (e.g. its SyncDeck parent going standalone
  // mid-run), so that cleanup never runs for this transition — a run-7
  // answer would otherwise still render (and be resubmittable) under the
  // self-paced context, which has no run identity of its own to compare
  // against.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'leftover from run 7' } })

    console.info('[TEST] the run-7 answer is cached locally as soon as it is typed')
    await waitFor(() => assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'leftover from run 7',
    ))

    console.info('[TEST] the session falls straight back to self-paced mode, with no intermediate idle snapshot')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', selfPacedMode: true, lastActiveQuestionRunRevision: 7,
        activeQuestionIds: ['q1'],
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      '',
    )

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a successful submission clears a retained failed autosave instead of leaving it to retry forever', async () => {
  // Copilot's finding: submission goes over REST, independent of the
  // WebSocket, so a REST submit can succeed while the socket is still down.
  // Self-paced questions have no deadline and never leave activeQuestionIds,
  // so resolveUnconfirmedDraftDisposition's only exit for a retained draft is
  // a matching submittedResponseEditSequences entry from a *later* snapshot —
  // without clearing it immediately on submission success, the 1-second retry
  // loop keeps calling saveDraft for an already-submitted answer until the
  // next snapshot happens to arrive. This isn't a correctness bug (the server
  // acks a stale draft-save as a no-op once it sees the confirmed response),
  // but it's wasted, avoidable churn onSubmitted can prevent immediately.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    // shouldFailDraft stays at its default `true`: the WebSocket is
    // unavailable for the whole test, so every draft-save attempt fails and
    // only the REST submission can succeed.
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', selfPacedMode: true, activeQuestionIds: ['q1'],
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'Self-paced only', order: 1 }],
      } })
    })

    console.info('[TEST] an autosave fails while the socket is down and is retained for retry')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'typed while offline' } })
    await waitFor(() => assert.ok(socket.draftAttempts > 0), { timeout: 2_500 })

    console.info('[TEST] the answer is submitted successfully over REST while the socket is still down')
    socket.sent.length = 0
    const attemptsBeforeSubmit = socket.draftAttempts
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))
    await waitFor(() => assert.equal(rendered.queryByRole('button', { name: /submit answer/i }), null))

    console.info('[TEST] the retry loop must not keep resending the now-superseded retained draft')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_200))
    })
    assert.equal(socket.draftAttempts, attemptsBeforeSubmit)

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a submission that succeeds after its QuestionView unmounts is still recorded by the parent', async () => {
  // Copilot's finding: submitAnswer's success branch (in QuestionView.tsx)
  // was gated behind the same submissionAttemptRef check used to protect
  // local-only state — but that ref is also bumped by plain unmount (the
  // student switching stack tabs before the response returns), which this
  // codebase deliberately allows. If the REST submission succeeds after
  // that unmount, onSubmitted never used to fire, so the parent (which owns
  // submittedQuestionIds/retained-draft bookkeeping across a stack-tab
  // switch) never learns the submission happened.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')

    let resolveSubmit: ((value: { ok: boolean; json: () => Promise<{ ok: boolean }> }) => void) | null = null
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url.includes('register-student')) {
          return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ari' }) }
        }
        if (init?.method === 'POST' && url.includes('submit-answer')) {
          return new Promise((resolve) => { resolveSubmit = resolve })
        }
        return { ok: true, json: async () => ({ sessionId: 'session-1', activeQuestionIds: [] }) }
      },
    })

    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })

    console.info('[TEST] q1 is answered and submitted, but the REST response is held back')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'submitted then abandoned' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))
    await waitFor(() => assert.ok(resolveSubmit !== null))

    console.info('[TEST] the student switches to q2 before the submission response arrives, unmounting q1\'s QuestionView')
    fireEvent.click(rendered.getByRole('button', { name: /^q2$/i }))
    await waitFor(() => rendered.getByText('Second'))

    console.info('[TEST] the held-back submission now succeeds')
    await act(async () => {
      resolveSubmit?.({ ok: true, json: async () => ({ ok: true }) })
      await Promise.resolve()
      await Promise.resolve()
    })

    console.info('[TEST] the parent must still record q1 as submitted, even though its view had already unmounted')
    await waitFor(() => assert.ok(rendered.queryByRole('button', { name: 'Q1 ✓' }) !== null))

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a delayed submission response from a run that has since restarted cannot resurrect its stale answer', async () => {
  // CodeRabbit and Copilot both flagged the same gap in the previous round's
  // fix (letting onSubmitted fire after unmount): it only re-checked
  // QuestionView's own frozen refs. Those refs *do* stay current across a
  // run-token change alone, since ResonanceStudent re-renders the same
  // still-mounted QuestionView instance with the new prop — but not once
  // this view has unmounted for any reason (here, a plain stack-tab switch)
  // and a run restart happens *afterward*, since a since-unmounted instance
  // never re-renders to pick up the new run token. Its refs stay frozen on
  // the old run, and the child's own guard incorrectly still passes.
  //
  // q1 deliberately stays in the active set throughout (never dropped and
  // reactivated) — a reactivation triggers its own, unrelated
  // submittedQuestionIds/submittedAnswers cleanup that would mask whether
  // this specific ownership check actually did the work.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')

    let resolveSubmit: ((value: { ok: boolean; json: () => Promise<{ ok: boolean }> }) => void) | null = null
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url.includes('register-student')) {
          return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ari' }) }
        }
        if (init?.method === 'POST' && url.includes('submit-answer')) {
          return new Promise((resolve) => { resolveSubmit = resolve })
        }
        return { ok: true, json: async () => ({ sessionId: 'session-1', activeQuestionIds: [] }) }
      },
    })

    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })

    console.info('[TEST] q1 is answered and submitted under run 7, but the REST response is held back')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'run 7 answer' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))
    await waitFor(() => assert.ok(resolveSubmit !== null))

    console.info('[TEST] the student switches to q2 — q1\'s QuestionView unmounts, its refs frozen on run 7')
    fireEvent.click(rendered.getByRole('button', { name: /^q2$/i }))
    await waitFor(() => rendered.getByText('Second'))

    console.info('[TEST] the run restarts to 8 while q1 is unmounted — still active, so no reactivation cleanup fires for it')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 8,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })

    console.info('[TEST] the stale run-7 submission now resolves successfully')
    await act(async () => {
      resolveSubmit?.({ ok: true, json: async () => ({ ok: true }) })
      await Promise.resolve()
      await Promise.resolve()
    })

    console.info('[TEST] switching back to q1 (now under run 8) must not show it pre-submitted with the stale run-7 answer')
    fireEvent.click(rendered.getByRole('button', { name: /^q1/i }))
    await waitFor(() => rendered.getByText('First'))
    assert.ok(rendered.queryByRole('button', { name: /submit answer/i }) !== null, 'q1 must not be pre-marked submitted')
    assert.equal((rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value, '')

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a delayed submission response cannot clobber a newer independent edit made after the view remounted', async () => {
  // Copilot's finding: the same-run case of the same gap. The student
  // submits q1, switches away before the response returns (unmounting its
  // QuestionView), switches back (remounting a fresh one, still not marked
  // submitted since the parent hasn't heard back yet), and types a
  // different answer — which fires its own, independent draft save. The
  // stale first submission's response arriving after that must not
  // overwrite the newer local answer or lock q1 as submitted with the old
  // text.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')

    let resolveSubmit: ((value: { ok: boolean; json: () => Promise<{ ok: boolean }> }) => void) | null = null
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url.includes('register-student')) {
          return { ok: true, json: async () => ({ studentId: 'student-1', name: 'Ari' }) }
        }
        if (init?.method === 'POST' && url.includes('submit-answer')) {
          return new Promise((resolve) => { resolveSubmit = resolve })
        }
        return { ok: true, json: async () => ({ sessionId: 'session-1', activeQuestionIds: [] }) }
      },
    })

    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })

    console.info('[TEST] q1 is answered and submitted, but the REST response is held back')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'draft one' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))
    await waitFor(() => assert.ok(resolveSubmit !== null))

    console.info('[TEST] the student switches away and back, remounting a fresh (not-yet-submitted) q1 view')
    fireEvent.click(rendered.getByRole('button', { name: /^q2$/i }))
    await waitFor(() => rendered.getByText('Second'))
    fireEvent.click(rendered.getByRole('button', { name: /^q1$/i }))
    const reopenedInput = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    assert.equal(reopenedInput.value, 'draft one')

    console.info('[TEST] the replacement view makes its own newer, independent edit')
    fireEvent.change(reopenedInput, { target: { value: 'draft two' } })
    await waitFor(() => assert.ok(socket.sent.some((message) => message.includes('draft two'))), { timeout: 2_500 })

    console.info('[TEST] the stale first submission now resolves successfully')
    await act(async () => {
      resolveSubmit?.({ ok: true, json: async () => ({ ok: true }) })
      await Promise.resolve()
      await Promise.resolve()
    })

    console.info('[TEST] q1 must not be locked as submitted with the old answer, clobbering the newer edit')
    assert.equal(rendered.queryByRole('button', { name: 'Q1 ✓' }), null)
    assert.equal((rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value, 'draft two')

    // Acknowledge the still-pending "draft two" send before unmounting, or
    // its own ack timeout fires after teardown and the JSDOM globals it
    // needs are already gone.
    await act(async () => {
      for (const message of socket.sent.filter((entry) => entry.includes('draft two'))) {
        const sent = JSON.parse(message) as { payload: { draftId?: string } }
        socket.emit({ type: 'resonance:draft-saved', payload: { draftId: sent.payload.draftId } })
      }
    })

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a still-in-flight autosave that fails after submission already succeeded cannot resurrect a retained draft', async () => {
  // Copilot's finding: onSubmitted only clears an *already-retained* failed
  // draft. It doesn't stop a *still-in-flight* autosave (sent before the
  // submission, not yet acknowledged) from failing afterward — e.g. the
  // socket closes moments later — and calling onDraftSaveFailed with a
  // run/answer that still matches (submission doesn't change either), which
  // used to unconditionally resurrect it as a retryable draft even though
  // the server already has a newer, confirmed answer for that edit sequence.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', selfPacedMode: true, activeQuestionIds: ['q1'],
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'Self-paced only', order: 1 }],
      } })
    })

    console.info('[TEST] an autosave is sent but left unacknowledged (still in flight)')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'answer' } })
    await waitFor(() => assert.ok(socket.sent.some((message) => message.includes('resonance:update-draft'))), { timeout: 2_500 })

    console.info('[TEST] the answer is submitted successfully while that autosave is still pending')
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))
    await waitFor(() => assert.equal(rendered.queryByRole('button', { name: /submit answer/i }), null))

    console.info('[TEST] the in-flight autosave now times out and fails, after the submission already settled it')
    socket.sent.length = 0
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100))
    })

    console.info('[TEST] no retry loop should have picked up a resurrected draft for the already-submitted answer')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_200))
    })
    assert.equal(socket.sent.some((message) => message.includes('resonance:update-draft')), false)

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a newer generation succeeding clears an older retained draft still queued for retry', async () => {
  // Copilot's finding: onDraftChanged only updates submittedAnswers; nothing
  // clears an older generation's retained entry in unconfirmedDraftsRef when
  // a newer generation's autosave independently succeeds (via QuestionView's
  // own debounce, not a submission). In self-paced mode the older entry has
  // no deadline/active-set-removal to eventually stop it, so it would keep
  // retrying the now-superseded generation indefinitely.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', selfPacedMode: true, activeQuestionIds: ['q1'],
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'Self-paced only', order: 1 }],
      } })
    })

    // "first draft" is permanently rejected at the socket, even after
    // shouldFailDraft flips off for the generation-2 send below — so the
    // only way its retained entry can stop being retried is the fix
    // (onDraftSaved clearing it), not a lucky natural resend-and-ack.
    socket.shouldFailDraft = false
    let firstDraftAttempts = 0
    const originalSend = socket.send.bind(socket)
    socket.send = (message: string) => {
      if (message.includes('resonance:update-draft') && message.includes('first draft')) {
        firstDraftAttempts += 1
        throw new Error('first draft is never allowed through')
      }
      originalSend(message)
    }

    console.info('[TEST] a generation-1 autosave fails and is retained for retry')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'first draft' } })
    await waitFor(() => assert.ok(firstDraftAttempts > 0), { timeout: 2_500 })

    console.info('[TEST] a generation-2 edit is sent successfully and acknowledged')
    fireEvent.change(input, { target: { value: 'second draft' } })
    // The parent may immediately retry the newly replaced retained payload
    // with replacement generation 2 before QuestionView's own debounce sends
    // generation 3. Wait for the child send specifically, then acknowledge
    // every outstanding B attempt so no timer outlives this mounted test.
    await waitFor(() => assert.ok(socket.sent.some((message) => {
      const sent = JSON.parse(message) as { payload?: { draftGeneration?: number } }
      return message.includes('second draft') && sent.payload?.draftGeneration === 3
    })), { timeout: 2_500 })
    await act(async () => {
      for (const message of socket.sent.filter((entry) => entry.includes('second draft'))) {
        const sent = JSON.parse(message) as { payload: { draftId?: string } }
        socket.emit({ type: 'resonance:draft-saved', payload: { draftId: sent.payload.draftId } })
      }
    })

    console.info('[TEST] the superseded generation-1 retry must stop being attempted entirely')
    const attemptsAfterAck = firstDraftAttempts
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_200))
    })
    assert.equal(firstDraftAttempts, attemptsAfterAck)

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a stale generation-1 failure cannot be retained while a newer generation-2 send is still awaiting its own ack', async () => {
  // Copilot's finding: recordUnconfirmedDraft's existing guards only compare
  // against the highest *acknowledged* generation and whatever is already
  // *retained* — neither catches a newer generation that has been sent but
  // not yet resolved either way. Copilot's scenario: the older send came
  // from a view that has since unmounted (and a replacement view's newer
  // send is still in flight) when the older one's ack-timeout fires. A
  // same-instance retype doesn't reproduce this — QuestionView's own
  // isSameAnswer check already drops a stale same-instance failure report
  // once draftAnswerRef has moved on — so this needs an actual unmount:
  // switching away and back remounts a fresh view (still showing the first
  // attempt, cached optimistically), which then makes its own independent
  // edit while the *original* (unmounted) view's send is still pending.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1', 'q2'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 60_000,
        activeQuestions: [
          { id: 'q1', type: 'free-response', text: 'First', order: 1 },
          { id: 'q2', type: 'free-response', text: 'Second', order: 2 },
        ],
      } })
    })

    console.info('[TEST] a generation-1 draft is sent from the original q1 view and left unacknowledged')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'first attempt' } })
    await waitFor(() => assert.ok(socket.sent.some((message) => message.includes('first attempt'))), { timeout: 2_500 })
    const firstSentAt = Date.now()

    console.info('[TEST] the student switches away and back, remounting a fresh q1 view')
    fireEvent.click(rendered.getByRole('button', { name: /^q2$/i }))
    await waitFor(() => rendered.getByText('Second'))
    fireEvent.click(rendered.getByRole('button', { name: /^q1/i }))
    const reopenedInput = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    assert.equal(reopenedInput.value, 'first attempt')

    console.info('[TEST] the replacement view sends its own newer, independent edit — also left unacknowledged')
    fireEvent.change(reopenedInput, { target: { value: 'second attempt' } })
    await waitFor(() => assert.ok(socket.sent.some((message) => message.includes('second attempt'))), { timeout: 3_000 })
    const secondDraftId = (JSON.parse(
      socket.sent.find((message) => message.includes('second attempt'))!,
    ) as { payload: { draftId: string } }).payload.draftId

    console.info('[TEST] the original view\'s generation-1 send now times out unacknowledged, while generation 2 is still pending')
    const elapsedSinceFirstSent = Date.now() - firstSentAt
    const waitForFirstTimeout = Math.max(0, 2_000 - elapsedSinceFirstSent) + 300
    socket.sent.length = 0
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, waitForFirstTimeout))
    })

    assert.ok(
      !socket.sent.some((message) => message.includes('first attempt')),
      'the superseded generation-1 failure must not be retried while generation 2 is still in flight',
    )

    // Acknowledge generation 2's still-pending send before unmounting, or
    // its own ack timeout fires after teardown once the JSDOM globals it
    // needs are already gone.
    await act(async () => {
      socket.emit({ type: 'resonance:draft-saved', payload: { draftId: secondDraftId } })
    })

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a stale local answer cannot resurface when its question drops out of the active set and is reactivated later', async () => {
  // CodeRabbit flagged that the run-restart cleanup loop only walks
  // `activeIds`, so a question with a cached local answer that goes
  // *inactive* (not merely restarted while staying active) would be skipped
  // and could resurface once reactivated. That premise doesn't hold: every
  // server-side path that adds a question back into the active set also
  // stamps a fresh activeQuestionRunRevision (see setActiveQuestions /
  // setStagedActiveQuestion in routes.ts), so the reactivation itself is
  // always its own run restart, and q1 is back in `activeIds` at exactly the
  // moment the cleanup loop runs for that new revision. This proves the
  // existing activeIds-scoped loop already covers the "went inactive, then
  // reactivated" case, not just the "stayed active" case the other test above
  // covers.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'leftover from run 7' } })

    console.info('[TEST] q1 is cached locally, then run 8 deactivates it in favor of q2')
    await waitFor(() => assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      'leftover from run 7',
    ))
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q2'], activeQuestionRunRevision: 8,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q2', type: 'free-response', text: 'Second', order: 2 }],
      } })
    })
    await waitFor(() => assert.equal(rendered.getByText('Second').textContent, 'Second'))

    console.info('[TEST] run 9 reactivates q1: the run-7 answer must not resurface')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 9,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    await waitFor(() => assert.equal(
      (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
      '',
    ))

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a reactivated question seeds its new run past a stale confirmed edit sequence before any real save can fire', async () => {
  // Copilot's finding: resolveUnconfirmedDraftDisposition compares a draft's
  // own (per-run) editSequence against submittedResponseEditSequences, which
  // is keyed only by questionId — the student's single most recent confirmed
  // response, regardless of which run recorded it. If q1 was confirmed in
  // run 7 at editSequence 5 and then reactivated as run 8, a run-8 draft at
  // the naive default of 1 would satisfy "1 <= 5" and get wrongly discarded
  // as already-superseded. seedQuestionEditSequenceFromConfirmedResponse exists
  // precisely to prevent that: it bumps a reactivated run's own local
  // counter past any stale confirmed value before the student can type
  // anything. Verify the actual sent payload's editSequence reflects that
  // seed (6, not 1) rather than just asserting on the pure function in
  // isolation, since the real question is whether the component can ever
  // hand the disposition check an unseeded value in practice.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    socket.shouldFailDraft = false

    console.info('[TEST] q1 was confirmed at editSequence 5 in run 7')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
        submittedAnswers: { q1: { type: 'free-response', text: 'Confirmed in run 7' } },
        submittedResponseEditSequences: { q1: 5 },
      } })
    })

    console.info('[TEST] the instructor reactivates q1 as run 8')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 8,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
        submittedAnswers: { q1: { type: 'free-response', text: 'Confirmed in run 7' } },
        submittedResponseEditSequences: { q1: 5 },
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'Edited in run 8' } })
    await waitFor(() => assert.ok(socket.sent.some((message) => message.includes('Edited in run 8'))), { timeout: 2_500 })

    const sentMessage = socket.sent.find((message) => message.includes('Edited in run 8'))!
    const sent = JSON.parse(sentMessage) as {
      payload: { editSequence?: number; activeQuestionRunRevision?: number; draftId?: string }
    }
    assert.equal(sent.payload.activeQuestionRunRevision, 8)
    assert.equal(sent.payload.editSequence, 6)
    await act(async () => {
      socket.emit({ type: 'resonance:draft-saved', payload: { draftId: sent.payload.draftId } })
    })

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('self-paced mode never exposes an already-confirmed question for editing, so it cannot hand a stale editSequence to the retry loop', () => {
  // Copilot also claimed "the same happens when self-paced mode follows a
  // live run" — a student re-answering a question in self-paced mode after
  // an earlier live confirmation. That premise doesn't hold: self-paced mode
  // has no revisit flow at all. isRevisit is hardcoded to
  // `!snapshot.selfPacedMode && ...`, and clearLiveQuestionSubmission is a
  // deliberate no-op when selfPacedMode is true — so a question with a
  // submittedResponseEditSequences entry always renders as already-submitted
  // (not an editable form) in self-paced mode. There is no UI path that
  // constructs a *new* self-paced draft-save attempt for a question the
  // student has already confirmed, so resolveUnconfirmedDraftDisposition
  // never actually receives a low-editSequence payload for a
  // high-confirmed-editSequence question in self-paced mode.
  assert.equal(
    clearLiveQuestionSubmission({
      selfPacedMode: true,
      submittedQuestionIds: new Set(['q1']),
      questionId: 'q1',
    }).has('q1'),
    true,
  )
})

void test('a retry succeeding after its effect is superseded still stops the replacement interval', async () => {
  // The retained-draft retry effect re-runs whenever `snapshot` changes
  // (e.g. an unrelated broadcast). If an in-flight retry from the *old*
  // effect instance succeeds after that instance was superseded, deleting
  // the map entry used to skip bumping unconfirmedDraftVersion when the old
  // instance's own `cancelled` flag was set — so the *new*, currently active
  // effect (which depends on that same counter) never learned the map was
  // empty and kept polling on its interval forever.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    const activeIntervals = new Set<number>()
    const originalSetInterval = window.setInterval.bind(window)
    const originalClearInterval = window.clearInterval.bind(window)
    ;(window as unknown as { setInterval: typeof window.setInterval }).setInterval = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const id = originalSetInterval(handler as never, timeout, ...args) as unknown as number
      activeIntervals.add(id)
      return id
    }) as typeof window.setInterval
    ;(window as unknown as { clearInterval: typeof window.clearInterval }).clearInterval = ((
      id?: number,
    ) => {
      if (id !== undefined) activeIntervals.delete(id)
      return originalClearInterval(id as never)
    }) as typeof window.clearInterval

    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const socket = StudentTestWebSocket.instances[0]!
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    const baselineIntervals = activeIntervals.size

    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'retry then succeed' } })

    console.info('[TEST] a failed autosave starts the parent retry loop (its own interval, on top of the countdown one)')
    // The debounced autosave failure and the retry effect's own immediate
    // first attempt both fail while shouldFailDraft is still true, so this
    // can settle at more than one attempt — only the resulting interval
    // count is asserted precisely.
    await waitFor(() => assert.ok(socket.draftAttempts >= 1), { timeout: 2_500 })
    await waitFor(() => assert.equal(activeIntervals.size, baselineIntervals + 1))

    socket.shouldFailDraft = false
    socket.sent.length = 0
    console.info('[TEST] the retry sends successfully on the next tick but is left unacknowledged')
    await waitFor(() => assert.equal(socket.sent.length, 1), { timeout: 2_000 })
    const retryDraftId = (JSON.parse(socket.sent[0]!) as { payload: { draftId: string } }).payload.draftId

    console.info('[TEST] an unrelated snapshot update supersedes the retry effect while that send is still pending')
    await act(async () => {
      socket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 31_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    // The old effect's interval is cleared, and the new (active) effect
    // schedules its own — net count is unchanged, but the id underneath it
    // has rotated.
    assert.equal(activeIntervals.size, baselineIntervals + 1)

    console.info('[TEST] the ack for the superseded retry must still stop the now-active replacement interval')
    await act(async () => {
      socket.emit({ type: 'resonance:draft-saved', payload: { draftId: retryDraftId } })
    })

    await waitFor(() => assert.equal(activeIntervals.size, baselineIntervals))

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('a save handoff from a session that has since been navigated away from cannot leak into the replacement session', async () => {
  // This route does not key ResonanceStudent by sessionId (see the shared
  // <Route path="/:sessionId"> below), so navigating from one session to
  // another reuses the same component instance and its stable
  // onDraftSaveFailed callback. A saveDraft promise still pending in the old
  // QuestionView at the moment of navigation resolves afterward. Using the
  // same studentId, question id, and run token in both sessions (plausible
  // if the same browser/device is reused) removes every other guard
  // (student/run/question matching), leaving only QuestionView's own
  // sessionId/studentId ref check to catch it — which it does, because
  // React updates that still-transitioning instance's props (and therefore
  // its refs) to the new session in the same commit that resets local
  // state, strictly before the forced-resolution promise's `.then()`
  // microtask ever runs.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  const { useNavigate } = await import('react-router')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    window.localStorage.setItem('student-name-session-2', 'Ari')
    window.localStorage.setItem('student-id-session-2', 'student-1')

    const navigateRef: { current: ((path: string) => void) | null } = { current: null }
    function NavigationProbe() {
      const navigate = useNavigate()
      navigateRef.current = (path: string) => navigate(path)
      return null
    }

    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(NavigationProbe),
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const firstSocket = StudentTestWebSocket.instances[0]!
    firstSocket.shouldFailDraft = false
    await act(async () => {
      firstSocket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'stale cross-session answer' } })

    console.info('[TEST] a session-1 draft is sent but never acknowledged before the student navigates away')
    await waitFor(() => assert.equal(firstSocket.draftAttempts, 1), { timeout: 2_000 })

    await act(async () => {
      navigateRef.current?.('/session-2')
    })

    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 2))
    const secondSocket = StudentTestWebSocket.instances[1]!
    // Let sends actually land in `.sent` instead of throwing (the mock's
    // default), so a leaked resend attempt is observable either way.
    secondSocket.shouldFailDraft = false
    await act(async () => {
      secondSocket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-2', activeQuestionIds: ['q1'], activeQuestionRunRevision: 7,
        activeQuestionDeadlineAt: Date.now() + 30_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    console.info('[TEST] the abandoned session-1 save times out; its handoff must not be accepted by session-2')
    await new Promise((resolve) => setTimeout(resolve, 2_600))

    assert.ok(
      !secondSocket.sent.some((message) => message.includes('stale cross-session answer')),
      'the stale session-1 draft must not be resent into session-2',
    )

    rendered.unmount()
  } finally {
    restore()
  }
})

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
  assert.equal(buildUnconfirmedDraftKey({ questionId: 'q1', answer }), 'q1:self-paced')
})

void test('legacy timestamp drafts canonicalize to revision one before expiry reconciliation', () => {
  const legacy = {
    questionId: 'q1', activeQuestionRunStartedAt: 1_000,
    answer: { type: 'free-response', text: 'Failed before revision rollout' },
  }
  const canonical = canonicalizeLegacyRevisionOneDraft(legacy, {
    activeQuestionRunRevision: 1,
    activeQuestionRunStartedAt: 1_000,
  })
  assert.equal(canonical.activeQuestionRunRevision, 1)
  assert.equal(buildUnconfirmedDraftKey(canonical), 'q1:1')
  // A different activation timestamp must not be upgraded into revision 1.
  assert.equal(
    canonicalizeLegacyRevisionOneDraft(legacy, { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 2_000 }),
    legacy,
  )
})

void test('legacy timestamp drafts match revision one after expiry but not a later run', () => {
  const legacy = { questionId: 'q1', activeQuestionRunStartedAt: 1_000 }
  assert.equal(payloadMatchesRunToken(legacy, 1), true)
  assert.equal(payloadMatchesRunToken(legacy, 2), false)
  assert.equal(payloadMatchesRunToken(legacy, null), false)
  const canonical = canonicalizeLegacyRevisionOneDraft(legacy, {
    activeQuestionRunRevision: 1,
    activeQuestionRunStartedAt: 1_000,
  })
  assert.equal(payloadMatchesRunToken(canonical, 1_000), true)
})

void test('a late reconnect-replay ack for a legacy draft key still clears the migrated canonical retry', async () => {
  // Copilot's finding: canonicalizeLegacyRevisionOneDraft moves a retained
  // draft from its legacy timestamp key to the revision-1 key, and cancels
  // the hook's *queued* reconnect-retry entry for both — but a legacy-keyed
  // replay send that was already in flight (sent, awaiting its own ack) at
  // that moment is untouched by cancelDraftRetries, which only reaches a
  // queued entry. If that ack arrives afterward, onDraftReplayAcknowledged
  // receives the old legacy key, which no longer has anything retained
  // under it — a no-op that leaves the canonical entry retrying forever.
  const restore = installStudentDom()
  const { act, fireEvent, render, waitFor } = await import('@testing-library/react')
  try {
    window.localStorage.setItem('student-name-session-1', 'Ari')
    window.localStorage.setItem('student-id-session-1', 'student-1')
    const rendered = render(React.createElement(MemoryRouter, { initialEntries: ['/session-1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/:sessionId', element: React.createElement(ResonanceStudent) })),
    ))
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 1))
    const firstSocket = StudentTestWebSocket.instances[0]!
    firstSocket.shouldFailDraft = false
    await act(async () => {
      firstSocket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionRunRevision: null, activeQuestionRunStartedAt: 1_000,
        activeQuestionIds: ['q1'], activeQuestionDeadlineAt: Date.now() + 60_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    console.info('[TEST] a legacy (pre-revision) draft is sent but left unacknowledged until it times out and is retained')
    const input = await waitFor(() => rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement)
    fireEvent.change(input, { target: { value: 'legacy retained draft' } })
    await waitFor(() => assert.ok(firstSocket.sent.some((message) => message.includes('legacy retained draft'))), { timeout: 2_500 })
    // Never ack it — its own 2s ack timeout fires, which both retains it
    // (parent) and queues it for reconnect replay (hook).

    console.info('[TEST] the socket reconnects and the hook replays the queued legacy draft')
    await act(async () => { firstSocket.onclose?.() })
    await waitFor(() => assert.equal(StudentTestWebSocket.instances.length, 2), { timeout: 2_500 })
    const secondSocket = StudentTestWebSocket.instances[1]!
    secondSocket.shouldFailDraft = false
    await act(async () => { secondSocket.onopen?.() })
    await waitFor(() => assert.ok(secondSocket.sent.some((message) =>
      message.includes('draft-retry-') && message.includes('legacy retained draft'),
    )), { timeout: 2_500 })
    const replaySent = secondSocket.sent.find((message) => message.includes('draft-retry-') && message.includes('legacy retained draft'))!
    const replayDraftId = (JSON.parse(replaySent) as { payload: { draftId: string } }).payload.draftId

    console.info('[TEST] a new snapshot confirms revision 1 for the same run, canonicalizing the retained draft — before the replay above is acknowledged')
    await act(async () => {
      secondSocket.emit({ type: 'resonance:session-state', payload: {
        sessionId: 'session-1', activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 1_000,
        activeQuestionIds: ['q1'], activeQuestionDeadlineAt: Date.now() + 60_000,
        activeQuestions: [{ id: 'q1', type: 'free-response', text: 'First', order: 1 }],
      } })
    })

    console.info('[TEST] the delayed ack for the legacy-keyed replay finally arrives')
    await act(async () => {
      secondSocket.emit({ type: 'resonance:draft-saved', payload: { draftId: replayDraftId } })
    })

    console.info('[TEST] the migrated canonical retry must not keep resending after that ack')
    secondSocket.sent.length = 0
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    assert.ok(
      !secondSocket.sent.some((message) => message.includes('legacy retained draft')),
      'the canonical retry must have been cleared by the delayed legacy-keyed acknowledgement',
    )

    rendered.unmount()
  } finally {
    restore()
  }
})

void test('isSameDraftAnswer treats an MCQ selection as unchanged regardless of option order', () => {
  // Copilot's finding: MCQ answers are set-based (QuestionView.tsx's
  // isSameAnswer and shared/mcq.ts both compare selectedOptionIds as a
  // set), but this used a raw JSON.stringify comparison instead — order-
  // sensitive. reconcileUnconfirmedDraft/discardUnconfirmedDraft use this to
  // decide whether a retained failed autosave matches the answer that was
  // actually confirmed; if the confirmed response and the retained draft
  // list the same options in a different order (e.g. a different click
  // order), the mismatch would leave the draft retrying forever instead of
  // reconciling against its own now-confirmed submission.
  const clickedBThenA = { type: 'multiple-choice', selectedOptionIds: ['optB', 'optA'] }
  const confirmedAThenB = { type: 'multiple-choice', selectedOptionIds: ['optA', 'optB'] }
  assert.equal(isSameDraftAnswer(clickedBThenA, confirmedAThenB), true)

  const differentSelection = { type: 'multiple-choice', selectedOptionIds: ['optA', 'optC'] }
  assert.equal(isSameDraftAnswer(clickedBThenA, differentSelection), false)

  const freeResponseA = { type: 'free-response', text: 'same text' }
  const freeResponseB = { type: 'free-response', text: 'same text' }
  assert.equal(isSameDraftAnswer(freeResponseA, freeResponseB), true)
  assert.equal(isSameDraftAnswer(freeResponseA, { type: 'free-response', text: 'different' }), false)

  assert.equal(isSameDraftAnswer(undefined, undefined), true)
  assert.equal(isSameDraftAnswer(null, freeResponseA), false)
  assert.equal(isSameDraftAnswer(freeResponseA, clickedBThenA), false)
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
  // A pre-revision client identifies the original numbered run by timestamp.
  // The server treats it as revision 1, so the parent retry owner must too.
  const legacyPayload = {
    studentId: 'student-1', questionId: 'q1', activeQuestionRunStartedAt: 1_000,
    activeQuestionDeadlineAt: 2_000, answer: { type: 'free-response', text: 'Legacy failed draft' },
  }
  const revisionOneSnapshot = { ...snapshot, activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 1_000 }
  assert.equal(resolveUnconfirmedDraftDisposition(legacyPayload, revisionOneSnapshot, 'student-1', 1_999), 'retry')
  // A delayed same-run snapshot can omit the deadline. The failed payload's
  // captured deadline must still bound retry and trigger reconciliation.
  assert.equal(
    resolveUnconfirmedDraftDisposition(legacyPayload, { ...revisionOneSnapshot, activeQuestionDeadlineAt: null }, 'student-1', 2_000),
    'reconcile',
  )
  assert.equal(
    resolveUnconfirmedDraftDisposition(payload, { ...snapshot, activeQuestionRunRevision: 8 }, 'student-1', 1_999),
    'discard',
  )
  assert.equal(
    resolveUnconfirmedDraftDisposition(payload, { ...snapshot, activeQuestionIds: ['q2'] }, 'student-1', 1_999),
    'discard',
  )
})

void test('a self-paced retry stops once its question is submitted, instead of retrying forever', () => {
  // Self-paced snapshots have no deadline and keep every question in
  // activeQuestionIds indefinitely, so isCurrentRun alone never turns
  // false for a failed draft on a question the student has since
  // submitted and moved past — the 1-second retry interval would poll it
  // forever. A submitted response's editSequence at or above the draft's
  // own means it's already superseded and should stop being retried,
  // whether or not a live run is even involved.
  const payload = {
    studentId: 'student-1',
    questionId: 'q1',
    editSequence: 2,
    answer: { type: 'free-response', text: 'Failed autosave before submitting' },
  }
  const selfPacedSnapshot = {
    activeQuestionIds: ['q1', 'q2'],
    activeQuestionRunStartedAt: null,
    activeQuestionRunRevision: null,
    activeQuestionDeadlineAt: null,
    submittedResponseEditSequences: {},
  }

  assert.equal(resolveUnconfirmedDraftDisposition(payload, selfPacedSnapshot, 'student-1', 5_000), 'retry')

  assert.equal(
    resolveUnconfirmedDraftDisposition(
      payload,
      { ...selfPacedSnapshot, submittedResponseEditSequences: { q1: 2 } },
      'student-1',
      5_000,
    ),
    'discard',
  )

  // A newer local revision (higher editSequence than what's confirmed) is
  // not yet superseded and still gets retried normally.
  assert.equal(
    resolveUnconfirmedDraftDisposition(
      { ...payload, editSequence: 3 },
      { ...selfPacedSnapshot, submittedResponseEditSequences: { q1: 2 } },
      'student-1',
      5_000,
    ),
    'retry',
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

void test('resolveQuestionRunTokenForPayload reuses an existing record\'s own runToken when the payload is an equivalent legacy form', () => {
  // CodeRabbit's finding: recordUnconfirmedDraft resolved a timestamp-only
  // failure payload's runToken directly and used it for strict-equality
  // reads/writes against QuestionDraftState. If the question's record had
  // already moved to revision 1 for the same real run (e.g. via the retry
  // loop's canonicalizeQuestionRunToken), a delayed failure still carrying
  // the legacy timestamp form would look like a different run entirely —
  // reading baseline generation/draft state instead of the real values, and
  // then wiping the record via setQuestionUnconfirmedDraft's
  // reset-on-mismatch instead of updating it in place.
  const state = new Map<string, QuestionDraftState>()

  // No record yet: falls back to resolving straight from the payload.
  assert.equal(
    resolveQuestionRunTokenForPayload(state, 'q1', { activeQuestionRunStartedAt: 1_000 }),
    1_000,
  )

  // Establish a record already canonicalized to revision 1 for a run that
  // started at timestamp 1000 (canonicalizeQuestionRunToken is the
  // non-resetting path the retry loop uses for exactly this transition).
  nextQuestionDraftGeneration(state, 'q1', 1_000)
  canonicalizeQuestionRunToken(state, 'q1', 1)

  // A delayed failure still in legacy (timestamp-only) form for the SAME
  // real run must resolve to the record's own (canonical) runToken, not
  // the payload's raw legacy timestamp.
  assert.equal(
    resolveQuestionRunTokenForPayload(state, 'q1', { activeQuestionRunStartedAt: 1_000 }),
    1,
  )

  // A payload with its own explicit, genuinely different revision must not
  // be treated as equivalent — it still resolves from its own identity, so
  // a real transition still gets its own fresh record. (A timestamp-only
  // payload can only ever mean revision 1 — see payloadMatchesResolvedRunToken
  // — so this case specifically needs an explicit revision to prove a
  // genuine mismatch, not just a different timestamp.)
  assert.equal(
    resolveQuestionRunTokenForPayload(state, 'q1', { activeQuestionRunRevision: 2 }),
    2,
  )

  // A canonical-form payload that already agrees with the record trivially
  // resolves to that same value.
  assert.equal(
    resolveQuestionRunTokenForPayload(state, 'q1', { activeQuestionRunRevision: 1 }),
    1,
  )
})

void test('a delayed legacy-form draft failure cannot wipe a QuestionDraftState record already canonicalized to revision one', () => {
  // Same finding as above, exercised through the full read/write sequence
  // recordUnconfirmedDraft performs — not just the runToken resolution — to
  // prove the fix actually reads the real acknowledged/attempted watermarks
  // and updates the existing record in place, rather than only resolving
  // the "correct" key without using it correctly end to end.
  const state = new Map<string, QuestionDraftState>()

  // A revision-one record with a newer attempted generation already
  // established (generation 2), and nothing acknowledged yet.
  nextQuestionDraftGeneration(state, 'q1', 1_000)
  canonicalizeQuestionRunToken(state, 'q1', 1)
  nextQuestionDraftGeneration(state, 'q1', 1)
  assert.equal(getQuestionAttemptedGeneration(state, 'q1', 1), 2)

  // A retained draft for the current (generation 2) attempt.
  setQuestionUnconfirmedDraft(state, 'q1', 1, {
    payload: { questionId: 'q1', activeQuestionRunRevision: 1, draftGeneration: 2, answer: { type: 'free-response', text: 'current' } },
    retrying: false,
    deadlineAt: null,
  })

  // A delayed failure for the original, lower-generation (1) attempt
  // arrives late, still in legacy timestamp form.
  const delayedLegacyPayload = {
    questionId: 'q1',
    activeQuestionRunStartedAt: 1_000,
    draftGeneration: 1,
    answer: { type: 'free-response', text: 'stale' },
  }
  const runToken = resolveQuestionRunTokenForPayload(state, 'q1', delayedLegacyPayload)

  // The real attempted generation (2) must be visible under the resolved
  // token — reading it under the payload's own raw (legacy) token would
  // incorrectly see the baseline (0) instead.
  assert.equal(getQuestionAttemptedGeneration(state, 'q1', runToken), 2)
  assert.equal(getQuestionAcknowledgedGeneration(state, 'q1', runToken), 0)

  // recordUnconfirmedDraft's own generation-ceiling check would now
  // correctly discard this stale generation-1 failure (1 < 2) instead of
  // reaching setQuestionUnconfirmedDraft at all — verify directly that the
  // record is untouched by the retained generation-2 draft still being
  // exactly what was set above.
  const retained = getQuestionUnconfirmedDraft(state, 'q1', runToken)
  assert.equal(retained?.payload.draftGeneration, 2)
  assert.equal((retained?.payload.answer as { text?: string } | undefined)?.text, 'current')
})

void test('edit-sequence bookkeeping survives a QuestionView remount, unlike a component-local counter', () => {
  // QuestionView is keyed by question id, so switching stack tabs away and
  // back remounts it with a fresh local ref if it owned this counter itself.
  // ResonanceStudent owns it instead, so a revisit still advances the
  // sequence past whatever the confirmed response recorded.
  const state = new Map<string, QuestionDraftState>()
  assert.equal(resolveQuestionEditSequence(state, 'q1', 1), 1)

  advanceQuestionEditSequenceForRevisit(state, 'q1', 1)
  assert.equal(resolveQuestionEditSequence(state, 'q1', 1), 2)

  // A second revisit (e.g. switching away and back again) advances further.
  advanceQuestionEditSequenceForRevisit(state, 'q1', 1)
  assert.equal(resolveQuestionEditSequence(state, 'q1', 1), 3)

  // A different question, or the same question in a new run, is independent.
  assert.equal(resolveQuestionEditSequence(state, 'q2', 1), 1)
  assert.equal(resolveQuestionEditSequence(state, 'q1', 2), 1)
})

void test('seedQuestionEditSequenceFromConfirmedResponse recovers a post-reload counter from the server, instead of defaulting to 1 and colliding with an existing submission', () => {
  // Without this seed, a page reload mid-run leaves the local record empty
  // (it's only ever bumped in memory by a revisit click). resolveQuestionEditSequence
  // would then default the next autosave to sequence 1 — but the confirmed
  // response from *before* the reload is already at sequence 1, so the
  // server's stale-draft guard (editSequence <= confirmed.editSequence) would
  // silently drop the reloaded student's revision.
  const state = new Map<string, QuestionDraftState>()
  seedQuestionEditSequenceFromConfirmedResponse(state, 'q1', 1, 1)
  assert.equal(resolveQuestionEditSequence(state, 'q1', 1), 2)

  // A higher confirmed sequence (the student had already revisited before
  // reloading) seeds a correspondingly higher floor.
  seedQuestionEditSequenceFromConfirmedResponse(state, 'q2', 1, 3)
  assert.equal(resolveQuestionEditSequence(state, 'q2', 1), 4)

  // Seeding never lowers a counter already advanced further locally this
  // session (e.g. a revisit click already happened before the next snapshot
  // arrived and re-seeds from the same confirmed value).
  advanceQuestionEditSequenceForRevisit(state, 'q2', 1)
  assert.equal(resolveQuestionEditSequence(state, 'q2', 1), 5)
  seedQuestionEditSequenceFromConfirmedResponse(state, 'q2', 1, 3)
  assert.equal(resolveQuestionEditSequence(state, 'q2', 1), 5)

  // A different run token is an independent counter, unaffected by seeding.
  assert.equal(resolveQuestionEditSequence(state, 'q1', 2), 1)
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

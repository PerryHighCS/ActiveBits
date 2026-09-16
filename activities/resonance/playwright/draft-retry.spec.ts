import { expect, test } from '@playwright/test'

interface InstructorProgressEntry {
  questionId: string
  studentId: string
  status: 'working' | 'submitted'
  answer: { type: string; text?: string } | null
}

test('a draft dropped mid-send is durably persisted after the client reconnects and retries', async ({ page }) => {
  // WebKit request contexts do not retain Set-Cookie responses in this
  // harness (see auth.spec.ts) — registration here consistently fails with
  // student-id-mismatch on webkit for that reason, unrelated to the retry
  // behavior this test actually exercises.
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')
  // Client-side unit tests mock the WebSocket, so they only prove the client
  // queues and resends a failed draft correctly — not that the real
  // `resonance:update-draft` handler actually accepts and persists a retried
  // payload. This drops the draft's first send attempt at the network layer
  // (closing the connection the moment it goes out, before the real server
  // ever sees it) and verifies persistence through the instructor's own
  // `/responses` progress view, which reads the server's stored
  // `responseDrafts` directly — not through any client-side state.
  const created = await page.request.post('/api/resonance/create', { data: {} })
  expect(created.ok()).toBe(true)
  const { id: sessionId, instructorPasscode } = await created.json() as {
    id: string
    instructorPasscode: string
  }
  const instructorHeaders = { 'x-instructor-passcode': instructorPasscode }
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/add-question`, {
    headers: instructorHeaders,
    data: { id: 'q1', type: 'free-response', text: 'Explain your reasoning.', order: 0 },
  })).ok()).toBe(true)
  // A deterministic, short deadline lets this test prove the actual
  // acceptance criterion (the retried draft is finalized into a submitted
  // response) instead of only that a persisted draft round-tripped to the
  // server — a passing "working" draft alone doesn't demonstrate the answer
  // survives deadline finalization the way a real timed question would need.
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/update-question-timer`, {
    headers: instructorHeaders,
    data: { questionId: 'q1', timeLimitMs: 8_000 },
  })).ok()).toBe(true)
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/activate-question`, {
    headers: instructorHeaders,
    data: { questionId: 'q1' },
  })).ok()).toBe(true)

  let droppedFirstDraft = false
  await page.routeWebSocket(/\/ws\/resonance/, (clientWs) => {
    const serverWs = clientWs.connectToServer()
    serverWs.onMessage((message) => clientWs.send(message))
    clientWs.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString('utf-8')
      if (!droppedFirstDraft && text.includes('resonance:update-draft')) {
        droppedFirstDraft = true
        // Simulate the connection dying with this message in flight: the
        // real server never receives it, and the client must notice (via
        // its ack timeout) and requeue it for the next connection.
        console.info('[TEST] dropping the first draft update by closing the WebSocket')
        void clientWs.close()
        return
      }
      serverWs.send(message)
    })
  })

  await page.goto(`/${encodeURIComponent(sessionId)}`)
  await page.getByLabel('Your name *').fill('Ada')
  await page.getByRole('button', { name: 'Join Session' }).click()
  await expect(page.getByText('Explain your reasoning.')).toBeVisible()

  const answerText = 'Playwright cross-boundary retry check'
  await page.getByLabel('Your answer').fill(answerText)

  await expect.poll(() => droppedFirstDraft, {
    message: 'expected the first draft-save attempt to be intercepted and dropped',
    timeout: 5_000,
  }).toBe(true)

  await expect.poll(async () => {
    const res = await page.request.get(`/api/resonance/${encodeURIComponent(sessionId)}/responses`, {
      headers: instructorHeaders,
    })
    if (!res.ok()) return null
    const body = await res.json() as { progress: InstructorProgressEntry[] }
    const entry = body.progress.find((p) => p.questionId === 'q1')
    return entry?.answer?.text ?? null
  }, {
    message: 'expected the retried draft to be persisted and visible to the instructor',
    timeout: 10_000,
  }).toBe(answerText)

  // The deadline (armed above at 8s) finalizes the retried draft into a real
  // submitted Response on the server's own schedule — no client interaction
  // needed. This is the actual acceptance criterion: a draft reaching
  // /responses as `status: 'working'` alone doesn't prove it survives that
  // finalization step, only that the retry itself round-tripped.
  await expect.poll(async () => {
    const res = await page.request.get(`/api/resonance/${encodeURIComponent(sessionId)}/responses`, {
      headers: instructorHeaders,
    })
    if (!res.ok()) return null
    const body = await res.json() as { progress: InstructorProgressEntry[] }
    const entry = body.progress.find((p) => p.questionId === 'q1')
    return entry?.status === 'submitted' ? entry.answer?.text ?? null : null
  }, {
    message: 'expected the retried draft to be finalized into a submitted response once the deadline passes',
    timeout: 20_000,
  }).toBe(answerText)
})

test('a failed autosave retained after a stack-tab switch still reaches the server (issue #374)', async ({ page }) => {
  // Copilot's finding on the previous test: with only one active question,
  // QuestionView never unmounts, so the failed draft can be — and is —
  // replayed entirely by useResonanceSession's own reconnect queue. That
  // proves the hook's internal retry works, but not the parent-level
  // retention (`unconfirmedDraftsRef` in ResonanceStudent.tsx) this PR
  // actually adds, which exists specifically to survive a QuestionView
  // *unmount* (switching stack tabs) — the real #374 regression. This test
  // activates two questions, drops Q1's first draft send without ever
  // closing the socket (so the hook's reconnect-replay path never fires),
  // switches to Q2 (unmounting Q1's QuestionView), and verifies the
  // parent's own retry-interval effect still gets the retained Q1 draft to
  // the server once the network stops dropping it.
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')

  const created = await page.request.post('/api/resonance/create', { data: {} })
  expect(created.ok()).toBe(true)
  const { id: sessionId, instructorPasscode } = await created.json() as {
    id: string
    instructorPasscode: string
  }
  const instructorHeaders = { 'x-instructor-passcode': instructorPasscode }
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/add-question`, {
    headers: instructorHeaders,
    data: { id: 'q1', type: 'free-response', text: 'Explain your reasoning.', order: 0 },
  })).ok()).toBe(true)
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/add-question`, {
    headers: instructorHeaders,
    data: { id: 'q2', type: 'free-response', text: 'A second, unrelated question.', order: 1 },
  })).ok()).toBe(true)
  expect((await page.request.post(`/api/resonance/${encodeURIComponent(sessionId)}/activate-question`, {
    headers: instructorHeaders,
    data: { questionIds: ['q1', 'q2'] },
  })).ok()).toBe(true)

  let q1DraftAttempts = 0
  let allowQ1Drafts = false
  await page.routeWebSocket(/\/ws\/resonance/, (clientWs) => {
    const serverWs = clientWs.connectToServer()
    serverWs.onMessage((message) => clientWs.send(message))
    clientWs.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString('utf-8')
      // Swallow every Q1 draft until Q1 unmounts, and never close the socket — unlike the sibling test above, this
      // deliberately keeps the connection alive so the hook's own
      // reconnect-on-open replay path (flushQueuedDraftRetries) never gets
      // a chance to fire, isolating the parent-level retry effect instead.
      if (text.includes('resonance:update-draft') && text.includes('"questionId":"q1"')) {
        q1DraftAttempts += 1
        if (!allowQ1Drafts) {
          console.info('[TEST] silently dropping a Q1 draft update until Q1 is unmounted')
          return
        }
      }
      serverWs.send(message)
    })
  })

  await page.goto(`/${encodeURIComponent(sessionId)}`)
  await page.getByLabel('Your name *').fill('Ada')
  await page.getByRole('button', { name: 'Join Session' }).click()
  await expect(page.getByText('Explain your reasoning.')).toBeVisible()

  const answerText = 'Retained across a stack-tab switch'
  await page.getByLabel('Your answer').fill(answerText)

  await expect.poll(() => q1DraftAttempts, {
    message: 'expected Q1 to attempt a save before the tab switch',
    timeout: 5_000,
  }).toBeGreaterThanOrEqual(1)

  // The second attempt proves the parent received the unacknowledged save
  // and started its own retained-draft retry before Q1 unmounts.
  await expect.poll(() => q1DraftAttempts, {
    message: 'expected the parent-owned Q1 retry before the tab switch',
    timeout: 6_000,
  }).toBeGreaterThanOrEqual(2)

  await page.getByRole('button', { name: 'Q2' }).click()
  await expect(page.getByText('A second, unrelated question.')).toBeVisible()
  allowQ1Drafts = true

  await expect.poll(async () => {
    const res = await page.request.get(`/api/resonance/${encodeURIComponent(sessionId)}/responses`, {
      headers: instructorHeaders,
    })
    if (!res.ok()) return null
    const body = await res.json() as { progress: InstructorProgressEntry[] }
    const entry = body.progress.find((p) => p.questionId === 'q1')
    return entry?.answer?.text ?? null
  }, {
    message: 'expected the parent-retained Q1 draft to survive the tab switch and reach the server',
    timeout: 10_000,
  }).toBe(answerText)
})

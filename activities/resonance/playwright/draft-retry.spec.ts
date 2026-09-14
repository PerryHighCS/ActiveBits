import { expect, test } from '@playwright/test'

interface InstructorProgressEntry {
  questionId: string
  studentId: string
  status: 'working' | 'submitted'
  answer: { type: string; text?: string } | null
}

test('a draft dropped mid-send is durably persisted after the client reconnects and retries', async ({ page }) => {
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
})

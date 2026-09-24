import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

interface JoinedStudent {
  page: Page
  context: BrowserContext
  sessionId: string
  studentId: string
}

async function startTwoQuestionSessionAndJoin(
  browser: Browser,
): Promise<JoinedStudent> {
  const context = await browser.newContext()
  const page = await context.newPage()

  const created = await page.request.post('/api/resonance/create', { data: {} })
  expect(created.ok()).toBe(true)
  const { id: sessionId, instructorPasscode } = await created.json() as {
    id: string
    instructorPasscode: string
  }
  const base = `/api/resonance/${encodeURIComponent(sessionId)}`
  const headers = { 'x-instructor-passcode': instructorPasscode }
  for (const [index, id] of ['q1', 'q2'].entries()) {
    expect((await page.request.post(`${base}/add-question`, {
      headers,
      data: { id, type: 'free-response', text: `Question ${index + 1} text`, order: index },
    })).ok()).toBe(true)
  }
  expect((await page.request.post(`${base}/activate-question`, {
    headers,
    data: { questionIds: ['q1', 'q2'] },
  })).ok()).toBe(true)

  return { page, context, sessionId, studentId: '' }
}

async function joinAsStudent(joined: JoinedStudent): Promise<string> {
  const { page, sessionId } = joined
  await page.goto(`/${encodeURIComponent(sessionId)}`)
  await page.getByLabel('Your name *').fill('Ada')
  await page.getByRole('button', { name: 'Join Session' }).click()
  await expect(page.getByText('Question 1 text')).toBeVisible()
  const studentId = await page.evaluate((id) => {
    const stored = window.localStorage.getItem(`session-participant:${id}`)
    return stored ? (JSON.parse(stored) as { studentId?: string }).studentId : undefined
  }, sessionId)
  expect(studentId).toBeTruthy()
  if (!studentId) throw new Error('Expected Resonance registration to persist a student id.')
  return studentId
}

async function readServerDraft(
  joined: JoinedStudent,
  questionId: string,
): Promise<string | null> {
  // Read through the page itself so the request carries exactly the httpOnly
  // capability cookie the browser holds.
  const result = await joined.page.evaluate(async ({ sessionId, studentId }) => {
    const response = await fetch(
      `/api/resonance/${encodeURIComponent(sessionId)}/state?studentId=${encodeURIComponent(studentId)}`,
    )
    return { status: response.status, body: await response.json() as unknown }
  }, { sessionId: joined.sessionId, studentId: joined.studentId })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  const state = result.body as {
    draftAnswers: Record<string, { type: string; text?: string }>
  }
  return state.draftAnswers[questionId]?.text ?? null
}

test.describe('Resonance draft persistence in a real browser', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'WebKit request contexts do not retain Set-Cookie responses in this harness.',
  )

  test('an unacknowledged draft survives a stack-tab switch and is saved by the retry loop (#374)', async ({ browser }) => {
    const joined = await startTwoQuestionSessionAndJoin(browser)
    const { page, context } = joined

    let dropDrafts = true
    let droppedDrafts = 0
    await page.routeWebSocket(/\/ws\/resonance/, (ws) => {
      const server = ws.connectToServer()
      ws.onMessage((message) => {
        if (dropDrafts && typeof message === 'string' && message.includes('resonance:update-draft')) {
          droppedDrafts += 1
          return
        }
        server.send(message)
      })
    })

    joined.studentId = await joinAsStudent(joined)

    await page.getByLabel('Your answer').fill('draft typed before switching tabs')
    await expect.poll(() => droppedDrafts, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(await readServerDraft(joined, 'q1')).toBeNull()

    // Switching tabs remounts QuestionView, which used to lose the unconfirmed draft.
    await page.getByRole('button', { name: 'Q2' }).click()
    await expect(page.getByText('Question 2 text')).toBeVisible()
    await page.getByRole('button', { name: 'Q1' }).click()
    await expect(page.getByLabel('Your answer')).toHaveValue('draft typed before switching tabs')

    // Let the parent-owned retry loop finally get an acknowledgement.
    dropDrafts = false
    await expect.poll(() => readServerDraft(joined, 'q1'), { timeout: 20_000 })
      .toBe('draft typed before switching tabs')

    await context.close()
  })
})

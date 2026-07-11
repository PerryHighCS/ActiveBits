import { expect, type Page, test } from '@playwright/test'

interface PostboardCreateResponse {
  id: string
  instructorPasscode: string
}

interface AcceptedStudent {
  studentId: string | null
  studentName: string
}

async function createPostboardSession(
  page: Page,
  selectedOptions: Record<string, unknown> = {},
): Promise<PostboardCreateResponse> {
  const response = await page.request.post('/api/postboard/create', {
    data: { selectedOptions },
  })
  expect(response.ok()).toBe(true)
  return await response.json() as PostboardCreateResponse
}

async function acceptStudent(page: Page, sessionId: string, studentName: string): Promise<AcceptedStudent> {
  const storeResponse = await page.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant`, {
    data: { values: { displayName: studentName } },
  })
  expect(storeResponse.ok()).toBe(true)
  const stored = await storeResponse.json() as {
    entryParticipantToken?: string
    values?: { participantId?: string }
  }
  expect(typeof stored.entryParticipantToken).toBe('string')
  expect(typeof stored.values?.participantId).toBe('string')

  const consumeResponse = await page.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant/consume`, {
    data: { token: stored.entryParticipantToken },
  })
  expect(consumeResponse.ok()).toBe(true)

  return {
    studentId: stored.values?.participantId ?? '',
    studentName,
  }
}

async function createInstructorPost(page: Page, session: PostboardCreateResponse, text: string): Promise<void> {
  const response = await page.request.post(`/api/postboard/${encodeURIComponent(session.id)}/posts`, {
    data: {
      text,
      instructorPasscode: session.instructorPasscode,
    },
  })
  expect(response.ok()).toBe(true)
}

async function openPostboardManager(
  page: Page,
  session: PostboardCreateResponse,
  query = '',
): Promise<void> {
  await page.addInitScript(({ instructorPasscode }) => {
    window.history.replaceState(
      {
        usr: { createSessionPayload: { instructorPasscode } },
        key: 'postboard-flow-playwright',
        idx: 0,
      },
      '',
      window.location.href,
    )
  }, { instructorPasscode: session.instructorPasscode })
  await page.goto(`/manage/postboard/${encodeURIComponent(session.id)}${query}`)
  await expect(page.getByRole('heading', { name: /Board Posts/ })).toBeVisible()
}

async function openPostboardStudent(
  page: Page,
  sessionId: string,
  student?: AcceptedStudent,
): Promise<void> {
  await page.addInitScript(({ sessionId: targetSessionId, student: targetStudent }) => {
    if (targetStudent) {
      window.localStorage.setItem(
        `session-participant:${targetSessionId}`,
        JSON.stringify({
          studentId: targetStudent.studentId,
          studentName: targetStudent.studentName,
        }),
      )
    }
  }, { sessionId, student })
  await page.goto(`/${encodeURIComponent(sessionId)}`)
  await expect(page.getByRole('heading', { name: 'Add a note' })).toBeVisible()
}

async function submitStudentNote(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Note' }).fill(text)
  await page.getByRole('button', { name: 'Submit note' }).click()
}

async function describedByText(page: Page, selector: string): Promise<string | null> {
  return await page.locator(selector).evaluate((element) => {
    const describedBy = element.getAttribute('aria-describedby')
    if (!describedBy) return null
    return document.getElementById(describedBy)?.textContent ?? null
  })
}

test('student pending note is visible to its author and can be approved by the instructor', async ({ browser }) => {
  const instructorPage = await browser.newPage()
  const studentPage = await browser.newPage()
  const session = await createPostboardSession(instructorPage, {
    prompt: 'Share one debugging move',
    autoApprove: false,
  })
  const ada = await acceptStudent(instructorPage, session.id, 'Ada Lovelace')

  await openPostboardStudent(studentPage, session.id, ada)
  await expect(studentPage.getByRole('heading', { name: 'Share one debugging move' })).toBeVisible()
  await submitStudentNote(studentPage, 'Check the console output')
  await expect(studentPage.locator('.postboard-card', { hasText: 'Check the console output' })).toHaveClass(/postboard-card/)
  await expect(studentPage.locator('.postboard-card-fade', { hasText: 'Check the console output' })).toBeVisible()

  await openPostboardManager(instructorPage, session)
  await expect(instructorPage.getByRole('heading', { name: 'Moderation Queue (1)' })).toBeVisible()
  await expect(instructorPage.getByRole('heading', { name: 'Board Posts (0)' })).toBeVisible()
  await instructorPage.locator('.postboard-moderation-panel .postboard-card', { hasText: 'Check the console output' })
    .getByRole('button', { name: 'Approve' })
    .click()
  await expect(instructorPage.getByRole('heading', { name: 'Board Posts (1)' })).toBeVisible()
  await expect(instructorPage.locator('.postboard-board .postboard-card', { hasText: 'Check the console output' })).toBeVisible()

  await expect(studentPage.locator('.postboard-card-fade', { hasText: 'Check the console output' })).toHaveCount(0, {
    timeout: 4_000,
  })
  await expect(studentPage.locator('.postboard-card', { hasText: 'Check the console output' })).toBeVisible()

  await instructorPage.close()
  await studentPage.close()
})

test('student reactions require accepted identity and expose current reaction accessibly', async ({ browser }) => {
  const seedPage = await browser.newPage()
  const anonymousPage = await browser.newPage()
  const studentPage = await browser.newPage()
  const session = await createPostboardSession(seedPage, {
    prompt: 'React to a shared note',
    autoApprove: true,
  })
  await createInstructorPost(seedPage, session, 'A note from the instructor')

  await openPostboardStudent(anonymousPage, session.id, { studentId: null, studentName: 'Waiting Student' })
  await expect(anonymousPage.getByRole('button', { name: 'Choose reaction' })).toHaveCount(0)

  const grace = await acceptStudent(seedPage, session.id, 'Grace Hopper')
  await openPostboardStudent(studentPage, session.id, grace)
  const pickerButton = studentPage.getByRole('button', { name: 'Choose reaction' })
  await expect(pickerButton).toBeVisible()
  await expect(pickerButton).toHaveText('☺')
  await expect.poll(() => describedByText(studentPage, 'button[aria-label="Choose reaction"]')).toBe('Current reaction: None')

  await pickerButton.click()
  await studentPage.getByRole('option', { name: 'React with Agree' }).click()
  await expect(pickerButton).toHaveText('👍')
  await expect(studentPage.getByText('👍 1')).toBeVisible()
  await expect.poll(() => describedByText(studentPage, 'button[aria-label="Choose reaction"]')).toBe('Current reaction: Agree')

  await seedPage.close()
  await anonymousPage.close()
  await studentPage.close()
})

test('launch defaults hydrate prompt and auto-approve while shared controls expose current selections', async ({ page }) => {
  const session = await createPostboardSession(page, {
    prompt: 'Launch prompt',
    autoApprove: true,
  })
  const lin = await acceptStudent(page, session.id, 'Lin Chen')

  await openPostboardManager(page, session)
  await expect(page.getByTitle('Launch prompt')).toHaveText('Launch prompt')
  await expect(page.getByRole('switch', { name: /Auto-approve is on/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: 'Board Posts (0)' })).toBeVisible()
  await expect.poll(() => describedByText(page, 'button[aria-labelledby]')).toBe('Current style: Lemon')

  const studentPage = await page.context().newPage()
  await openPostboardStudent(studentPage, session.id, lin)
  await expect(studentPage.getByRole('heading', { name: 'Launch prompt' })).toBeVisible()
  await submitStudentNote(studentPage, 'Auto-approved note')
  await expect(studentPage.locator('.postboard-card', { hasText: 'Auto-approved note' })).toBeVisible()
  await expect(studentPage.locator('.postboard-card-fade', { hasText: 'Auto-approved note' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Board Posts (1)' })).toBeVisible()
  await expect(page.locator('.postboard-board .postboard-card', { hasText: 'Auto-approved note' })).toBeVisible()
  await studentPage.close()
})

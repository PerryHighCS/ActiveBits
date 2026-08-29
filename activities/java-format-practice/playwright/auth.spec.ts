import { expect, test } from '@playwright/test'

test('Java Format manager and accepted participant recover from httpOnly cookies', async ({ browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')
  const context = await browser.newContext()
  const managerPage = await context.newPage()
  const created = await managerPage.request.post('/api/java-format-practice/create')
  expect(created.ok()).toBe(true)
  const { id: sessionId } = await created.json() as { id: string }

  await managerPage.goto(`/manage/java-format-practice/${encodeURIComponent(sessionId)}`)
  await expect(managerPage.getByRole('heading', { name: 'Format Difficulty Level' })).toBeVisible()

  const stored = await managerPage.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant`, {
    data: { values: { displayName: 'Ada' } },
  })
  const entry = await stored.json() as { entryParticipantToken: string }
  await managerPage.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant/consume`, {
    data: { token: entry.entryParticipantToken },
  })
  const cookieName = `activebits_participant_${Buffer.from(sessionId).toString('base64url')}`
  const cookie = (await managerPage.context().cookies()).find((entryCookie) => entryCookie.name === cookieName)
  expect(cookie).toBeTruthy()

  // Use a second tab in the instructor context: it sends both the manager and
  // participant cookies, so this proves the student socket selects its own
  // valid participant principal rather than inheriting manager authority.
  const studentPage = await context.newPage()
  await studentPage.addInitScript(({ id }) => {
    window.localStorage.setItem(`session-participant:${id}`, JSON.stringify({ studentId: 'hint-only', studentName: 'Ada' }))
  }, { id: sessionId })
  await studentPage.goto(`/${encodeURIComponent(sessionId)}`)
  await expect(studentPage.getByRole('heading', { name: 'Your Progress' })).toBeVisible()
  await expect(managerPage.getByText('Ada', { exact: true })).toBeVisible()

  await managerPage.close()
  await studentPage.close()
  await context.close()
})

test('Java Format returns a participant with a lost capability to normal entry', async ({ browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')
  const page = await browser.newPage()
  const created = await page.request.post('/api/java-format-practice/create')
  const { id: sessionId } = await created.json() as { id: string }
  const stored = await page.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant`, {
    data: { values: { displayName: 'Ada' } },
  })
  const entry = await stored.json() as { entryParticipantToken: string }
  await page.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant/consume`, {
    data: { token: entry.entryParticipantToken },
  })
  const cookieName = `activebits_participant_${Buffer.from(sessionId).toString('base64url')}`
  await page.context().clearCookies({ name: cookieName })
  await page.goto(`/${encodeURIComponent(sessionId)}`)
  await expect(page.getByRole('button', { name: 'Join Session' })).toBeVisible()
  await page.close()
})

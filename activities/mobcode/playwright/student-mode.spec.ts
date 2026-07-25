import { expect, type Page, test } from '@playwright/test'

interface MobCodeCreateResponse {
  id: string
  instructorPasscode: string
}

async function createMobCodeSession(page: Page): Promise<MobCodeCreateResponse> {
  const response = await page.request.post('/api/mobcode/create')
  expect(response.ok()).toBe(true)
  return await response.json() as MobCodeCreateResponse
}

async function seedMobCodeFile(page: Page, session: MobCodeCreateResponse): Promise<void> {
  const response = await page.request.post(`/api/mobcode/${encodeURIComponent(session.id)}/state`, {
    data: {
      instructorPasscode: session.instructorPasscode,
      files: { 'starter.py': 'print("starter")\n' },
      activeFile: 'starter.py',
      messageType: 'file-tree-changed',
    },
  })
  expect(response.ok()).toBe(true)
}

async function acceptStudent(seedPage: Page, studentPage: Page, sessionId: string, displayName: string): Promise<void> {
  const storedResponse = await seedPage.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant`, {
    data: { values: { displayName } },
  })
  expect(storedResponse.ok()).toBe(true)
  const stored = await storedResponse.json() as { entryParticipantToken?: unknown }
  expect(typeof stored.entryParticipantToken).toBe('string')
  const consumedResponse = await seedPage.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant/consume`, {
    data: { token: stored.entryParticipantToken },
  })
  expect(consumedResponse.ok()).toBe(true)

  const cookieName = `activebits_participant_${Buffer.from(sessionId).toString('base64url')}`
  const match = new RegExp(`^${cookieName}=([^;]+)`).exec(consumedResponse.headers()['set-cookie'] ?? '')
  if (!match?.[1]) throw new Error('Expected the accepted participant cookie from the server.')
  await studentPage.goto('/')
  const origin = new URL(studentPage.url())
  await studentPage.context().addCookies([{
    name: cookieName,
    value: match[1],
    domain: origin.hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }])
}

async function openMobCodeManager(page: Page, session: MobCodeCreateResponse): Promise<void> {
  await page.addInitScript(({ instructorPasscode }) => {
    window.history.replaceState(
      { usr: { createSessionPayload: { instructorPasscode } }, key: 'mobcode-student-mode', idx: 0 },
      '',
      window.location.href,
    )
  }, { instructorPasscode: session.instructorPasscode })
  await page.goto(`/manage/mobcode/${encodeURIComponent(session.id)}`)
  await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible()
}

test('starting Try it moves an accepted student to My Code', async ({ browser }) => {
  const instructorPage = await browser.newPage()
  const studentPage = await browser.newPage()
  const session = await createMobCodeSession(instructorPage)
  await seedMobCodeFile(instructorPage, session)
  await acceptStudent(instructorPage, studentPage, session.id, 'Ada Lovelace')

  await studentPage.goto(`/${encodeURIComponent(session.id)}`)
  await expect(studentPage.getByRole('tab', { name: 'Instructor' })).toHaveAttribute('aria-selected', 'true')

  await openMobCodeManager(instructorPage, session)
  await instructorPage.getByRole('button', { name: 'Try it' }).click()

  const myCodeTab = studentPage.getByRole('tab', { name: 'My Code' })
  await expect(myCodeTab).toBeVisible({ timeout: 10_000 })
  await expect(myCodeTab).toHaveAttribute('aria-selected', 'true')
  await expect(studentPage.getByText('starter.py', { exact: true })).toBeVisible()

  await instructorPage.close()
  await studentPage.close()
})

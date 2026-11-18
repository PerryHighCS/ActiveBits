import { expect, type APIRequestContext, type Page, test } from '@playwright/test'

interface CreatedSession {
  id: string
  instructorPasscode: string
}

async function createSession(request: APIRequestContext): Promise<CreatedSession> {
  const response = await request.post('/api/commissioned-ideas/create')
  expect(response.ok()).toBe(true)
  return await response.json() as CreatedSession
}

async function createTeamViaApi(request: APIRequestContext, sessionId: string, name: string): Promise<void> {
  const reg = await request.post(`/api/commissioned-ideas/${sessionId}/register-participant`, { data: { name } })
  expect(reg.ok()).toBe(true)
  const who = await reg.json() as { participantId: string; token: string }
  const team = await request.post(`/api/commissioned-ideas/${sessionId}/create-team`, {
    data: { participantId: who.participantId },
    headers: { 'X-Commissioned-Ideas-Participant-Token': who.token },
  })
  expect(team.ok()).toBe(true)
}

async function joinAsStudent(page: Page, sessionId: string, name: string): Promise<void> {
  await page.goto(`/${sessionId}`)
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.getByText(`Joined as ${name}`)).toBeVisible()
}

test('a refused stored credential offers the registration form again', async ({ page, request }) => {
  const session = await createSession(request)
  await joinAsStudent(page, session.id, 'Dana')

  // The server no longer accepts this browser's stored token.
  await page.evaluate((id) => window.localStorage.setItem(`ci:${id}:token`, 'NOT-A-REAL-TOKEN'), session.id)
  await page.reload()

  await expect(page.getByTestId('ci-registration-notice')).toContainText('couldn’t restore your earlier sign-in')
  await expect(page.getByLabel('Your name')).toHaveValue('Dana')
  const stored = await page.evaluate((id) => window.localStorage.getItem(`ci:${id}:token`), session.id)
  expect(stored).toBeNull()

  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.getByText('Joined as Dana')).toBeVisible()
  await expect(page.getByTestId('ci-registration-notice')).toHaveCount(0)

  // The new credential survives a reload.
  await page.reload()
  await expect(page.getByText('Joined as Dana')).toBeVisible()
  await expect(page.getByTestId('ci-my-team-status')).toBeVisible()
})

test('keyboard focus stays in the roster after joining and leaving a team', async ({ page, request }) => {
  const session = await createSession(request)
  await createTeamViaApi(request, session.id, 'Eli')
  await joinAsStudent(page, session.id, 'Fay')

  await page.getByRole('button', { name: /^Join / }).focus()
  await page.keyboard.press('Enter')
  const status = page.getByTestId('ci-my-team-status')
  await expect(status).toContainText('Your team:')
  await expect(status).toBeFocused()

  await page.getByRole('button', { name: 'Leave team' }).focus()
  await page.keyboard.press('Enter')
  await expect(status).toContainText('You’re not on a team yet.')
  await expect(status).toBeFocused()
})

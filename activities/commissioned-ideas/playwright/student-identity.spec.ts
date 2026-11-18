import { expect, type APIRequestContext, type Page, test } from '@playwright/test'
import { createTeamViaApi, skipStudentBrowserFlowsOnWebKit } from './studentApi'

interface CreatedSession {
  id: string
  instructorPasscode: string
}

async function createSession(request: APIRequestContext): Promise<CreatedSession> {
  const response = await request.post('/api/commissioned-ideas/create')
  expect(response.ok()).toBe(true)
  return await response.json() as CreatedSession
}

async function joinAsStudent(page: Page, sessionId: string, name: string): Promise<void> {
  await page.goto(`/${sessionId}`)
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.getByText(`Joined as ${name}`)).toBeVisible()
}

async function participantCookie(page: Page): Promise<{ name: string; value: string; httpOnly: boolean } | undefined> {
  return (await page.context().cookies()).find((cookie) => cookie.name.startsWith('activebits_cap_participant_'))
}

test('the student credential is an httpOnly cookie, never script-readable storage', async ({ page, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  await joinAsStudent(page, session.id, 'Cy')

  const cookie = await participantCookie(page)
  expect(cookie?.httpOnly).toBe(true)
  const exposed = await page.evaluate((secret) => {
    const inStorage = (storage: Storage) =>
      Object.keys(storage).some((key) => key.includes(secret) || (storage.getItem(key) ?? '').includes(secret))
    return {
      documentCookie: document.cookie.includes(secret),
      localStorage: inStorage(window.localStorage),
      sessionStorage: inStorage(window.sessionStorage),
    }
  }, cookie?.value ?? 'missing')
  expect(exposed).toEqual({ documentCookie: false, localStorage: false, sessionStorage: false })

  // Reload keeps the identity through the cookie alone.
  await page.reload()
  await expect(page.getByText('Joined as Cy')).toBeVisible()
  await expect(page.getByTestId('ci-my-team-status')).toBeVisible()
})

test('a refused participant cookie offers the registration form again', async ({ page, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  await joinAsStudent(page, session.id, 'Dana')

  // The browser lost its participant cookie (expired or cleared); the stored name and id remain.
  await page.context().clearCookies({ name: /^activebits_cap_participant_/ })
  await page.reload()

  await expect(page.getByTestId('ci-registration-notice')).toContainText('couldn’t restore your earlier sign-in')
  await expect(page.getByLabel('Your name')).toHaveValue('Dana')

  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.getByText('Joined as Dana')).toBeVisible()
  await expect(page.getByTestId('ci-registration-notice')).toHaveCount(0)

  // The new cookie survives a reload.
  await page.reload()
  await expect(page.getByText('Joined as Dana')).toBeVisible()
  await expect(page.getByTestId('ci-my-team-status')).toBeVisible()
})

test('losing local storage alone keeps the same participant', async ({ page, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  await createTeamViaApi(request, session.id, 'Eli')
  await joinAsStudent(page, session.id, 'Gia')
  await page.getByRole('button', { name: /^Join / }).click()
  await expect(page.getByTestId('ci-my-team-status')).toContainText('Your team:')

  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.getByLabel('Your name').fill('Gia')
  await page.getByRole('button', { name: 'Join' }).click()

  // The cookie reconnected the same participant, still on the team.
  await expect(page.getByTestId('ci-my-team-status')).toContainText('Your team:')
  await expect(page.getByText('(you)')).toHaveCount(1)
})

test('keyboard focus stays in the roster after joining and leaving a team', async ({ page, request }) => {
  skipStudentBrowserFlowsOnWebKit()
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

import { expect, type APIRequestContext, type Page, test } from '@playwright/test'
import { createTeamViaApi, registerStudentViaApi, skipStudentBrowserFlowsOnWebKit } from './studentApi'

interface CreatedSession {
  id: string
  instructorPasscode: string
}

async function createSession(request: APIRequestContext): Promise<CreatedSession> {
  const response = await request.post('/api/commissioned-ideas/create')
  expect(response.ok()).toBe(true)
  return await response.json() as CreatedSession
}

async function setPhase(request: APIRequestContext, session: CreatedSession, phase: string): Promise<void> {
  const res = await request.post(`/api/commissioned-ideas/${session.id}/phase`, {
    data: { phase },
    headers: { 'X-Commissioned-Ideas-Instructor-Passcode': session.instructorPasscode },
  })
  expect(res.ok()).toBe(true)
}

async function openManager(page: Page, session: CreatedSession): Promise<void> {
  await page.addInitScript(({ instructorPasscode }) => {
    window.history.replaceState(
      { usr: { createSessionPayload: { instructorPasscode } }, key: 'ci-playwright', idx: 0 },
      '',
      window.location.href,
    )
  }, { instructorPasscode: session.instructorPasscode })
  await page.goto(`/manage/commissioned-ideas/${encodeURIComponent(session.id)}`)
  await expect(page.getByRole('navigation', { name: 'Activity phase' })).toBeVisible()
}

test('a late arrival appears for the instructor and can vote once placed on a team', async ({ page, browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  for (const name of ['Eli', 'Fay', 'Gus']) await createTeamViaApi(request, session.id, name)
  await setPhase(request, session, 'presentation')
  await setPhase(request, session, 'voting')

  await openManager(page, session)
  await expect(page.getByRole('region', { name: /Late arrivals/ })).toHaveCount(0)
  await expect(page.getByTestId('ci-vote-count')).toContainText('0 of 3 voted')

  const studentContext = await browser.newContext()
  try {
    const student = await studentContext.newPage()
    await student.goto(`/${session.id}`)
    await student.getByLabel('Your name').fill('Late Larry')
    await student.getByRole('button', { name: 'Join' }).click()

    // Student is told they must wait, and gets no ballot.
    await expect(student.getByText('Teams are already formed.')).toBeVisible()
    await expect(student.getByText('You’re not on a team yet.')).toBeVisible()
    await expect(student.getByRole('region', { name: 'Fund the best ideas' })).toHaveCount(0)

    // Instructor sees the late arrival; they do not count as a voter yet.
    const late = page.getByRole('region', { name: 'Late arrivals (1)' })
    await expect(late).toBeVisible()
    await expect(late.getByTestId('ci-late-arrival')).toContainText('Late Larry')
    await expect(page.getByTestId('ci-waiting-for-team')).toContainText('1 student is waiting for a team')
    await expect(page.getByTestId('ci-vote-count')).toContainText('0 of 3 voted')

    // Place them on Team 2; the option shows its current size against the max (default 4).
    await late.getByRole('combobox', { name: 'Place Late Larry on a team' }).selectOption({ label: 'Team 2 (1/4)' })
    await expect(page.getByRole('region', { name: /Late arrivals/ })).toHaveCount(0)
    await expect(page.getByTestId('ci-vote-count')).toContainText('0 of 4 voted')

    // The student now gets a ballot that excludes their new team.
    const ballot = student.getByRole('region', { name: 'Fund the best ideas' })
    await expect(ballot).toBeVisible()
    await expect(student.getByText('Teams are already formed.')).toHaveCount(0)
    await expect(ballot.getByRole('group', { name: '$500 award' }).getByRole('radio', { name: /Team 2/ })).toHaveCount(0)
    await expect(ballot).toContainText('There are only 2 other teams, so you have 2 awards to give.')

    await ballot.getByRole('group', { name: '$500 award' }).getByRole('radio', { name: /Team 1/ }).check()
    await ballot.getByRole('group', { name: '$300 award' }).getByRole('radio', { name: /Team 3/ }).check()
    await ballot.getByRole('button', { name: 'Submit ballot' }).click()
    await expect(student.getByRole('region', { name: '✓ Ballot submitted' })).toBeVisible()
    await expect(page.getByTestId('ci-vote-count')).toContainText('1 of 4 voted')
  } finally {
    await studentContext.close()
  }
})

test('placing late arrivals keeps keyboard focus on the next placement, then on the "all placed" status', async ({ page, request }) => {
  const session = await createSession(request)
  for (const name of ['Eli', 'Fay']) await createTeamViaApi(request, session.id, name)
  await setPhase(request, session, 'presentation')
  await registerStudentViaApi(request, session.id, 'Ann')
  await registerStudentViaApi(request, session.id, 'Bob')

  await openManager(page, session)
  const late = page.getByRole('region', { name: 'Late arrivals (2)' })
  await expect(late).toBeVisible()

  const annSelect = late.getByRole('combobox', { name: 'Place Ann on a team' })
  await annSelect.focus()
  await annSelect.selectOption({ index: 1 })
  // Ann's row is removed by the snapshot; focus moves to the next waiting student.
  await expect(page.getByRole('combobox', { name: 'Place Ann on a team' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Place Bob on a team' })).toBeFocused()

  await page.getByRole('combobox', { name: 'Place Bob on a team' }).selectOption({ index: 1 })
  const done = page.getByTestId('ci-late-arrivals-done')
  await expect(done).toHaveText('All late arrivals are placed.')
  await expect(done).toBeFocused()
})

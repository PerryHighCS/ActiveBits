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

function queueLabels(page: Page): Promise<string[]> {
  return page.getByTestId('ci-queue-item').evaluateAll((items) => items.map((item) => item.getAttribute('data-team-label') ?? ''))
}

test('instructor runs presentations and the student view follows the spotlight', async ({ page, browser, request }) => {
  const session = await createSession(request)

  const studentContext = await browser.newContext()
  try {
    const student = await studentContext.newPage()
    await student.goto(`/${session.id}`)
    await student.getByLabel('Your name').fill('Dana')
    await student.getByRole('button', { name: 'Join' }).click()
    await student.getByRole('button', { name: '+ Create a new team' }).click()
    await expect(student.getByText('Your team: Team 1')).toBeVisible()

    await createTeamViaApi(request, session.id, 'Eli')
    await createTeamViaApi(request, session.id, 'Fay')

    await openManager(page, session)
    const phaseNav = page.getByRole('navigation', { name: 'Activity phase' })
    await expect(phaseNav.getByRole('button', { name: /Results/ })).toBeDisabled()
    await phaseNav.getByRole('button', { name: /Presentations/ }).click()
    await expect(phaseNav.getByRole('button', { name: /Presentations/ })).toHaveAttribute('aria-current', 'step')

    await expect(student.getByRole('heading', { name: /Presentations · Round 1/ })).toBeVisible()
    await expect.poll(() => queueLabels(page)).toEqual(['Team 1', 'Team 2', 'Team 3'])

    // Reorder: move Team 3 earlier, persisted server-side.
    await page.getByRole('button', { name: 'Move Team 3 earlier' }).click()
    await expect.poll(() => queueLabels(page)).toEqual(['Team 1', 'Team 3', 'Team 2'])

    // Spotlight the student's team; the student sees it live.
    await page.getByRole('button', { name: 'Spotlight Team 1' }).click()
    await expect(page.getByTestId('ci-spotlight-team')).toHaveText('Team 1')
    await expect(student.getByText("You're on stage!")).toBeVisible()

    // Next follows the queue order.
    await page.getByRole('button', { name: 'Next →' }).click()
    await expect(page.getByTestId('ci-spotlight-team')).toHaveText('Team 3')
    await expect(student.getByTestId('ci-student-spotlight')).toHaveText('Team 3')

    // Random picks the only team left, then is exhausted.
    await page.getByRole('button', { name: /Random team \(1 left\)/ }).click()
    await expect(page.getByTestId('ci-spotlight-team')).toHaveText('Team 2')
    await expect(page.getByRole('button', { name: /Random team \(0 left\)/ })).toBeDisabled()

    // New round clears the stage and the presented markers.
    await page.getByRole('button', { name: 'Start round 2' }).click()
    await expect(page.getByText(/Round 2 · 0\/3 presented/)).toBeVisible()
    await expect(student.getByRole('heading', { name: /Round 2/ })).toBeVisible()
    await expect(student.getByText('Waiting for the next team…')).toBeVisible()

    // Survives a manager reload.
    await page.reload()
    await expect(page.getByText(/Round 2 · 0\/3 presented/)).toBeVisible()
    await expect.poll(() => queueLabels(page)).toEqual(['Team 1', 'Team 3', 'Team 2'])
  } finally {
    await studentContext.close()
  }
})

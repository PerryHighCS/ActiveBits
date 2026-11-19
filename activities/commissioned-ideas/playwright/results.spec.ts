import { expect, type APIRequestContext, type Page, test } from '@playwright/test'
import { postAsStudent, registerStudentViaApi, skipStudentBrowserFlowsOnWebKit, type ApiStudent } from './studentApi'

interface CreatedSession {
  id: string
  instructorPasscode: string
}

async function createSession(request: APIRequestContext): Promise<CreatedSession> {
  const response = await request.post('/api/commissioned-ideas/create')
  expect(response.ok()).toBe(true)
  return await response.json() as CreatedSession
}

async function asStudent(request: APIRequestContext, sessionId: string, who: ApiStudent, path: string, body: Record<string, unknown> = {}) {
  const res = await postAsStudent(request, sessionId, who, path, body)
  expect(res.ok()).toBe(true)
  return await res.json() as Record<string, unknown>
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

test('instructor reveals 3rd, 2nd, then the winner and the student podium follows', async ({ page, browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)

  const studentContext = await browser.newContext()
  try {
    const student = await studentContext.newPage()
    await student.goto(`/${session.id}`)
    await student.getByLabel('Your name').fill('Dana')
    await student.getByRole('button', { name: 'Join' }).click()
    await student.getByRole('button', { name: '+ Create a new team' }).click()
    await expect(student.getByText('Your team: Team 1')).toBeVisible()

    // Teams 2–4. Eli (Team 2) is the voter — only students on a team can vote.
    const teamIds: string[] = []
    const members: ApiStudent[] = []
    for (const name of ['Eli', 'Fay', 'Gus']) {
      const who = await registerStudentViaApi(request, session.id, name)
      members.push(who)
      teamIds.push((await asStudent(request, session.id, who, 'create-team')).teamId as string)
    }
    const voter = members[0]!
    const state = await (await request.get(`/api/commissioned-ideas/${session.id}/state`)).json() as {
      data: { teams: Record<string, { id: string; registeredAt: number }> }
    }
    const team1 = Object.values(state.data.teams).sort((a, b) => a.registeredAt - b.registeredAt)[0]!.id
    const [, team3, team4] = teamIds as [string, string, string]

    await setPhase(request, session, 'presentation')
    await setPhase(request, session, 'voting')
    // Ranking: Team 4 ($500) > Team 3 ($300) > Team 1 ($100, Dana's team) > Team 2 ($0)
    await asStudent(request, session.id, voter, 'ballot', {
      allocations: [{ teamId: team4, amount: 500 }, { teamId: team3, amount: 300 }, { teamId: team1, amount: 100 }],
    })

    await openManager(page, session)
    await page.getByRole('navigation', { name: 'Activity phase' }).getByRole('button', { name: /Results/ }).click()

    // Nothing is revealed yet, anywhere.
    await expect(student.getByRole('heading', { name: '🥁 The results are in…' })).toBeVisible()
    await expect(student.getByTestId('ci-podium-team')).toHaveCount(0)
    await expect(page.getByTestId('ci-podium-team')).toHaveCount(0)

    await page.getByRole('button', { name: 'Reveal 3rd place' }).click()
    await expect(student.getByTestId('ci-podium-place-3')).toHaveAccessibleName('3rd place: Team 1, $100')
    await expect(student.getByText('Your team placed 3rd!')).toBeVisible()
    await expect(student.getByTestId('ci-podium-place-1')).toHaveAccessibleName('1st place: not yet revealed')

    await page.getByRole('button', { name: 'Reveal 2nd place' }).click()
    await expect(student.getByTestId('ci-podium-place-2')).toHaveAccessibleName('2nd place: Team 3, $300')
    await expect(student.getByTestId('ci-podium-place-1')).toHaveAccessibleName('1st place: not yet revealed')

    await page.getByRole('button', { name: 'Reveal the winner' }).click()
    await expect(student.getByTestId('ci-podium-place-1')).toHaveAccessibleName('1st place: Team 4, $500')

    await page.getByRole('button', { name: 'Show final podium' }).click()
    await expect(page.getByRole('heading', { name: '🏆 Team 4 wins!' })).toBeVisible()
    await expect(student.getByRole('heading', { name: '🏆 Team 4 wins!' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reveal complete' })).toBeDisabled()

    // Full ranking is available to the instructor behind the spoiler toggle.
    await page.getByText('Full rankings').click()
    await expect(page.getByTestId('ci-ranking-row')).toHaveCount(4)
    await expect(page.getByTestId('ci-ranking-row').last()).toContainText('Team 2')

    // Reset hides everything again for both views.
    await page.getByRole('button', { name: 'Reset reveal' }).click()
    await expect(student.getByTestId('ci-podium-team')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reveal 3rd place' })).toBeEnabled()

    // Back to presentations clears the podium from the student view.
    await page.getByRole('navigation', { name: 'Activity phase' }).getByRole('button', { name: /Presentations/ }).click()
    await expect(student.getByRole('heading', { name: /Presentations · Round/ })).toBeVisible()
  } finally {
    await studentContext.close()
  }
})

test('teams with equal funding share the winner step', async ({ page, browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)

  const studentContext = await browser.newContext()
  try {
    const student = await studentContext.newPage()
    await student.goto(`/${session.id}`)
    await student.getByLabel('Your name').fill('Dana')
    await student.getByRole('button', { name: 'Join' }).click()
    await student.getByRole('button', { name: '+ Create a new team' }).click()
    await expect(student.getByText('Your team: Team 1')).toBeVisible()

    const teamIds: string[] = []
    const members: ApiStudent[] = []
    for (const name of ['Eli', 'Fay', 'Gus']) {
      const who = await registerStudentViaApi(request, session.id, name)
      members.push(who)
      teamIds.push((await asStudent(request, session.id, who, 'create-team')).teamId as string)
    }
    const state = await (await request.get(`/api/commissioned-ideas/${session.id}/state`)).json() as {
      data: { teams: Record<string, { id: string; registeredAt: number }> }
    }
    const team1 = Object.values(state.data.teams).sort((a, b) => a.registeredAt - b.registeredAt)[0]!.id
    const [team2, team3, team4] = teamIds as [string, string, string]
    const [, fay, gus] = members as [ApiStudent, ApiStudent, ApiStudent]

    await setPhase(request, session, 'presentation')
    await setPhase(request, session, 'voting')
    // Fay (Team 3) and Gus (Team 4) vote: Teams 1 and 2 both reach $800; Teams 3 and 4 both get $100.
    await asStudent(request, session.id, fay, 'ballot', {
      allocations: [{ teamId: team1, amount: 500 }, { teamId: team2, amount: 300 }, { teamId: team4, amount: 100 }],
    })
    await asStudent(request, session.id, gus, 'ballot', {
      allocations: [{ teamId: team2, amount: 500 }, { teamId: team1, amount: 300 }, { teamId: team3, amount: 100 }],
    })

    await openManager(page, session)
    await page.getByRole('navigation', { name: 'Activity phase' }).getByRole('button', { name: /Results/ }).click()

    // Two funding levels → two steps: no 3rd place.
    await expect(student.getByTestId('ci-podium-place-3')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reveal 2nd place' })).toBeVisible()

    await page.getByRole('button', { name: 'Reveal 2nd place' }).click()
    await expect(student.getByTestId('ci-podium-place-2')).toHaveAccessibleName('2nd place (tie): Team 3 and Team 4, $100')

    await page.getByRole('button', { name: 'Reveal the winner' }).click()
    await expect(student.getByTestId('ci-podium-place-1')).toHaveAccessibleName('1st place (tie): Team 1 and Team 2, $800')
    await expect(student.getByText('Your team tied for the win!')).toBeVisible()

    await page.getByRole('button', { name: 'Show final podium' }).click()
    await expect(page.getByRole('heading', { name: '🏆 Team 1 and Team 2 tie for the win!' })).toBeVisible()
    await expect(student.getByRole('heading', { name: '🏆 Team 1 and Team 2 tie for the win!' })).toBeVisible()
  } finally {
    await studentContext.close()
  }
})

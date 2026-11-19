import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test'
import { createTeamViaApi, postAsStudent, registerStudentViaApi, skipStudentBrowserFlowsOnWebKit } from './studentApi'

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

/** Student joins through the real UI and creates their own team (always "Team 1"). */
async function joinAsStudentWithTeam(browser: Browser, sessionId: string, name: string) {
  const context = await browser.newContext()
  const student = await context.newPage()
  await student.goto(`/${sessionId}`)
  await student.getByLabel('Your name').fill(name)
  await student.getByRole('button', { name: 'Join' }).click()
  await student.getByRole('button', { name: '+ Create a new team' }).click()
  await expect(student.getByText('Your team: Team 1')).toBeVisible()
  return { context, student }
}

test('student fills, submits, and changes a full ballot while the manager tracks progress', async ({ page, browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  const { context, student } = await joinAsStudentWithTeam(browser, session.id, 'Dana')
  try {
    for (const name of ['Eli', 'Fay', 'Gus']) await createTeamViaApi(request, session.id, name)
    await setPhase(request, session, 'presentation')

    await openManager(page, session)
    await page.getByRole('navigation', { name: 'Activity phase' }).getByRole('button', { name: /Voting/ }).click()
    await expect(page.getByTestId('ci-vote-count')).toContainText('0 of 4 voted')

    const ballot = student.getByRole('region', { name: 'Fund the best ideas' })
    await expect(ballot).toBeVisible()
    const award = (amount: number) => ballot.getByRole('group', { name: `$${amount} award` })

    // Own team is not offered.
    await expect(award(500).getByRole('radio', { name: /Team 1/ })).toHaveCount(0)

    await award(500).getByRole('radio', { name: /Team 2/ }).check()
    await award(300).getByRole('radio', { name: /Team 3/ }).check()
    // Moving Team 3 to $500 frees the $300 slot.
    await award(500).getByRole('radio', { name: /Team 3/ }).check()
    await expect(award(300).getByRole('radio', { name: /Team 3/ })).not.toBeChecked()
    await expect(ballot.getByRole('button', { name: 'Submit ballot' })).toBeDisabled()

    await award(300).getByRole('radio', { name: /Team 2/ }).check()
    await award(100).getByRole('radio', { name: /Team 4/ }).check()
    await ballot.getByRole('button', { name: 'Submit ballot' }).click()

    const done = student.getByRole('region', { name: '✓ Ballot submitted' })
    await expect(done).toBeVisible()
    await expect(student.getByRole('status').filter({ hasText: 'Ballot submitted.' })).toHaveCount(1)
    await expect(done.getByRole('list', { name: 'Your awards' })).toContainText('$500Team 3')
    await expect(page.getByTestId('ci-vote-count')).toContainText('1 of 4 voted')
    await expect(page.locator('[data-testid="ci-voter"][data-voted="true"]')).toHaveText(/Dana/)

    // Change the ballot; the count must not double.
    await done.getByRole('button', { name: 'Change my ballot' }).click()
    await award(500).getByRole('radio', { name: /Team 4/ }).check()
    await award(100).getByRole('radio', { name: /Team 3/ }).check()
    await ballot.getByRole('button', { name: 'Update ballot' }).click()
    await expect(done.getByRole('list', { name: 'Your awards' })).toContainText('$500Team 4')
    await expect(student.getByTestId('ci-ballot-status')).toHaveText('Ballot updated.')
    await expect(page.getByTestId('ci-vote-count')).toContainText('1 of 4 voted')

    // Ballot survives a student reload.
    await student.reload()
    await expect(student.getByRole('region', { name: '✓ Ballot submitted' })).toContainText('$500Team 4')
  } finally {
    await context.close()
  }
})

test('with only two teams a student gets a single $500 award', async ({ browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  const { context, student } = await joinAsStudentWithTeam(browser, session.id, 'Dana')
  try {
    await createTeamViaApi(request, session.id, 'Eli')
    await setPhase(request, session, 'presentation')
    await setPhase(request, session, 'voting')

    const ballot = student.getByRole('region', { name: 'Fund the best ideas' })
    await expect(ballot).toContainText('There is only 1 other team, so you have 1 award to give.')
    await expect(ballot.getByRole('group')).toHaveCount(1)
    await expect(ballot.getByRole('group', { name: '$500 award' })).toBeVisible()

    await ballot.getByRole('radio', { name: /Team 2/ }).check()
    await ballot.getByRole('button', { name: 'Submit ballot' }).click()
    await expect(student.getByRole('region', { name: '✓ Ballot submitted' })).toContainText('$500Team 2')
  } finally {
    await context.close()
  }
})

test('a selected team deleted by moderation while the ballot is open disables Submit until the award is re-chosen', async ({ browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  const { context, student } = await joinAsStudentWithTeam(browser, session.id, 'Dana')
  try {
    const eli = await registerStudentViaApi(request, session.id, 'Eli')
    expect((await postAsStudent(request, session.id, eli, 'create-team')).ok()).toBe(true)
    for (const name of ['Fay', 'Gus', 'Hal']) await createTeamViaApi(request, session.id, name)
    await setPhase(request, session, 'presentation')
    await setPhase(request, session, 'voting')

    const ballot = student.getByRole('region', { name: 'Fund the best ideas' })
    await expect(ballot).toBeVisible()
    const award = (amount: number) => ballot.getByRole('group', { name: `$${amount} award` })
    const submit = ballot.getByRole('button', { name: 'Submit ballot' })
    // Eli's team is Team 2: give it $500, and fill the rest.
    await award(500).getByRole('radio', { name: /Team 2/ }).check()
    await award(300).getByRole('radio', { name: /Team 3/ }).check()
    await award(100).getByRole('radio', { name: /Team 4/ }).check()
    await expect(submit).toBeEnabled()

    // Moderation takes Eli off; their now-empty team is deleted while Dana's draft is open.
    const moderation = await request.post(`/api/commissioned-ideas/${session.id}/participant-name`, {
      data: { participantId: eli.participantId, rejected: true },
      headers: { 'X-Commissioned-Ideas-Instructor-Passcode': session.instructorPasscode },
    })
    expect(moderation.ok()).toBe(true)

    // Three other teams remain, so three awards are still required, and $500 has no choice.
    await expect(award(500).getByRole('radio', { checked: true })).toHaveCount(0)
    await expect(submit).toBeDisabled()
    // Hal's team (last in order) holds no award yet; giving it $500 completes the ballot.
    await award(500).getByRole('radio').last().check()
    await expect(submit).toBeEnabled()
  } finally {
    await context.close()
  }
})

import { expect, type APIRequestContext, type Page, test } from '@playwright/test'
import { createTeamViaApi, postAsStudent, registerStudentViaApi, skipStudentBrowserFlowsOnWebKit, type ApiStudent } from './studentApi'

interface CreatedSession {
  id: string
  instructorPasscode: string
}

async function createSession(request: APIRequestContext): Promise<CreatedSession> {
  const response = await request.post('/api/commissioned-ideas/create')
  expect(response.ok()).toBe(true)
  return await response.json() as CreatedSession
}

async function studentPost(
  request: APIRequestContext,
  sessionId: string,
  who: ApiStudent,
  path: string,
  body: Record<string, unknown> = {},
) {
  const response = await postAsStudent(request, sessionId, who, path, body)
  expect(response.ok()).toBe(true)
  return await response.json() as Record<string, unknown>
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
  await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible()
}

function teamCard(page: Page, memberName: string) {
  return page.getByTestId('ci-team-card').filter({
    has: page.locator(`[data-participant-name="${memberName}"]`),
  })
}

function chip(page: Page, name: string) {
  return page.locator(`[data-testid="ci-member-chip"][data-participant-name="${name}"]`)
}

function waitForAssign(page: Page) {
  return page.waitForResponse((response) =>
    response.url().includes('/assign-participant') && response.request().method() === 'POST',
  )
}

test('instructor drags students between teams, to a new team, and back to ungrouped', async ({ page, request }) => {
  const session = await createSession(request)
  const alice = await registerStudentViaApi(request, session.id, 'Alice')
  const bob = await registerStudentViaApi(request, session.id, 'Bob')
  await registerStudentViaApi(request, session.id, 'Carol')
  await studentPost(request, session.id, alice, 'create-team')
  const { teamId } = await studentPost(request, session.id, bob, 'create-team')
  expect(teamId).toBeTruthy()

  await openManager(page, session)
  await expect(page.getByTestId('ci-team-card')).toHaveCount(2)
  await expect(page.getByTestId('ci-ungrouped-zone').locator('[data-participant-name="Carol"]')).toBeVisible()

  // Ungrouped → Alice's team
  let assigned = waitForAssign(page)
  await chip(page, 'Carol').dragTo(teamCard(page, 'Alice'))
  await assigned
  await expect(teamCard(page, 'Alice').locator('[data-participant-name="Carol"]')).toBeVisible()

  // Team → team: move Bob into Alice's team (Bob's old team empties and disappears)
  assigned = waitForAssign(page)
  await chip(page, 'Bob').dragTo(teamCard(page, 'Alice'))
  await assigned
  await expect(teamCard(page, 'Alice').getByTestId('ci-member-chip')).toHaveCount(3)
  await expect(page.getByTestId('ci-team-card')).toHaveCount(1)

  // Team → new team
  assigned = waitForAssign(page)
  await chip(page, 'Carol').dragTo(page.getByTestId('ci-new-team-zone'))
  await assigned
  await expect(page.getByTestId('ci-team-card')).toHaveCount(2)
  await expect(teamCard(page, 'Carol').getByTestId('ci-member-chip')).toHaveCount(1)

  // Keyboard alternative: move Bob to ungrouped with the select
  assigned = waitForAssign(page)
  await page.getByRole('combobox', { name: 'Move Bob to' }).selectOption({ label: 'Ungrouped' })
  await assigned
  await expect(page.getByTestId('ci-ungrouped-zone').locator('[data-participant-name="Bob"]')).toBeVisible()
  // The chip is re-created under the destination list; focus follows it.
  await expect(page.getByTestId('ci-ungrouped-zone').getByRole('combobox', { name: 'Move Bob to' })).toBeFocused()

  // Keyboard move to a new team keeps focus on the moved student's select too.
  assigned = waitForAssign(page)
  await page.getByRole('combobox', { name: 'Move Bob to' }).selectOption({ label: 'New team' })
  await assigned
  await expect(teamCard(page, 'Bob').getByRole('combobox', { name: 'Move Bob to' })).toBeFocused()

  assigned = waitForAssign(page)
  await page.getByRole('combobox', { name: 'Move Bob to' }).selectOption({ label: 'Ungrouped' })
  await assigned
  await expect(page.getByTestId('ci-ungrouped-zone').getByRole('combobox', { name: 'Move Bob to' })).toBeFocused()

  // If the instructor moves focus elsewhere while a move is in flight, the move must not
  // pull focus back when it lands.
  let releaseMove: () => void = () => {}
  const moveHeld = new Promise<void>((resolve) => { releaseMove = resolve })
  await page.route('**/assign-participant', async (route) => {
    await moveHeld
    await route.continue()
  })
  assigned = waitForAssign(page)
  await page.getByRole('combobox', { name: 'Move Bob to' }).selectOption({ label: 'New team' })
  const copyLink = page.getByRole('button', { name: 'Copy link' })
  await copyLink.focus()
  releaseMove()
  // The move really committed: check the answer, not just that a response arrived.
  const moveResponse = await assigned
  expect(moveResponse.ok()).toBe(true)
  const moved = await moveResponse.json() as { teamId?: unknown; revision?: unknown }
  expect(typeof moved.teamId).toBe('string')
  expect(typeof moved.revision).toBe('number')
  // Wait for the move to settle completely: Bob's relocated select is enabled again
  // (controls are no longer busy), and two animation frames let any restoration run.
  const bobsSelect = teamCard(page, 'Bob').getByRole('combobox', { name: 'Move Bob to' })
  await expect(bobsSelect).toBeEnabled()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(copyLink).toBeFocused()
  await expect(bobsSelect).not.toBeFocused()
  await page.unroute('**/assign-participant')

  // Survives reload (state is server-side, not optimistic): Bob is alone on that new team.
  await page.reload()
  await expect(teamCard(page, 'Bob').getByTestId('ci-member-chip')).toHaveCount(1)
  await expect(teamCard(page, 'Alice').getByTestId('ci-member-chip')).toHaveCount(1)
})

test('student proposes and votes on names; instructor rejection updates the student view live', async ({ page, browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  await openManager(page, session)

  const studentContext = await browser.newContext()
  try {
    const student = await studentContext.newPage()
    await student.goto(`/${session.id}`)
    await student.getByLabel('Your name').fill('Dana')
    await student.getByRole('button', { name: 'Join' }).click()
    await expect(student.getByRole('button', { name: '+ Create a new team' })).toBeVisible()
    await student.getByRole('button', { name: '+ Create a new team' }).click()

    const naming = student.getByRole('region', { name: 'Name your team' })
    await expect(naming).toBeVisible()

    await naming.getByLabel('Suggest a team name').fill('Rude Name')
    await naming.getByLabel('Suggest a team name').press('Enter')
    await expect(naming.getByRole('radio', { name: /Rude Name/ })).toBeChecked()

    await naming.getByLabel('Suggest a team name').fill('Night Owls')
    await naming.getByLabel('Suggest a team name').press('Enter')
    await expect(naming.getByRole('radio', { name: /Night Owls/ })).toBeChecked()

    // Move the vote back; tie-break favors the earlier proposal anyway, so check the current label.
    await naming.getByRole('radio', { name: /Rude Name/ }).check()
    await expect(naming.getByText('Current: Rude Name')).toBeVisible()

    // Manager sees the proposal and rejects it.
    await expect(page.getByRole('heading', { name: 'Rude Name', level: 3 })).toBeVisible()
    await page.getByRole('button', { name: 'Reject team name “Rude Name”' }).click()

    await expect(naming.getByRole('radio', { name: /Rude Name/ })).toHaveCount(0)
    await expect(naming.getByText('Current: Night Owls')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Night Owls', level: 3 })).toBeVisible()

    // Naming lock disables suggestions.
    await page.getByRole('button', { name: 'Lock naming' }).click()
    await expect(naming.getByText('Naming is locked by your instructor.')).toBeVisible()
    await expect(naming.getByLabel('Suggest a team name')).toHaveCount(0)
  } finally {
    await studentContext.close()
  }
})

test('a refused Join returns keyboard focus to the Join button once it is enabled again', async ({ browser, request }) => {
  skipStudentBrowserFlowsOnWebKit()
  const session = await createSession(request)
  await createTeamViaApi(request, session.id, 'Ann')

  const studentContext = await browser.newContext()
  try {
    const student = await studentContext.newPage()
    await student.goto(`/${session.id}`)
    await student.getByLabel('Your name').fill('Dana')
    await student.getByRole('button', { name: 'Join' }).click()

    const join = student.getByRole('button', { name: /^Join / })
    await expect(join).toBeVisible()
    // Hold the request until the button has rendered disabled (busy), then refuse it:
    // the refusal settles while the button cannot take focus yet.
    await student.route('**/join-team', async (route) => {
      await expect(join).toBeDisabled()
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '[TEST] Team is full' }) })
    })
    await join.focus()
    await join.press('Enter')

    await expect(student.getByRole('alert')).toContainText('[TEST] Team is full')
    await expect(join).toBeEnabled()
    await expect(join).toBeFocused()
  } finally {
    await studentContext.close()
  }
})

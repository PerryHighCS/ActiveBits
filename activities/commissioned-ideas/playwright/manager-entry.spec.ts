import { expect, type Page, test } from '@playwright/test'

async function expectManagerReady(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/manage\/commissioned-ideas\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Session settings' })).toBeVisible()
  await expect(page.getByText('Instructor passcode not found.')).toHaveCount(0)

  // The passcode must not linger in any browser-side store: session/local
  // storage, or router state in window.history (cleared after the handoff).
  const leaks = await page.evaluate(() => {
    const historyState = JSON.stringify(window.history.state ?? null)
    return {
      sessionStorage: Object.keys(window.sessionStorage).some((key) => key.includes('commissioned-ideas')),
      localStorage: Object.keys(window.localStorage).some((key) => key.includes('commissioned-ideas')),
      historyState: historyState.includes('instructorPasscode'),
    }
  })
  expect(leaks).toEqual({ sessionStorage: false, localStorage: false, historyState: false })
}

/**
 * A real reload: nothing is re-injected, so recovery must come from the httpOnly
 * manager cookie (possibly after core reissues it from the persistent teacher cookie).
 * Chromium only — WebKit rejects the Secure cookie on the harness HTTP origin;
 * production Safari runs on HTTPS. Same convention as video-sync and syncdeck specs.
 */
async function reloadAndExpectManagerReady(page: Page): Promise<void> {
  if (test.info().project.name !== 'chromium') return
  const exchanges: number[] = []
  const onResponse = (response: { url(): string; status(): number }) => {
    if (response.url().includes('/instructor-passcode')) exchanges.push(response.status())
  }
  page.on('response', onResponse)
  try {
    await page.reload()
    await expectManagerReady(page)
  } finally {
    page.off('response', onResponse)
  }
  expect(exchanges.at(-1)).toBe(200)
}

function sessionIdFromUrl(page: Page): string {
  const sessionId = new URL(page.url()).pathname.split('/').at(-1)
  expect(sessionId).toBeTruthy()
  return sessionId ?? ''
}

test('dashboard creation opens an authenticated manager that survives a reload', async ({ page }) => {
  await page.goto('/manage')

  const card = page.getByRole('heading', { name: 'Commissioned Ideas' }).locator('../..')
  await card.getByRole('button', { name: 'Start Session Now' }).click()

  await expectManagerReady(page)
  await reloadAndExpectManagerReady(page)
})

test('a browser without the manager cookie cannot recover the passcode', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit rejects the Secure manager cookie on the harness HTTP origin; production Safari runs on HTTPS.')
  await page.goto('/manage')
  const card = page.getByRole('heading', { name: 'Commissioned Ideas' }).locator('../..')
  await card.getByRole('button', { name: 'Start Session Now' }).click()
  await expectManagerReady(page)
  const sessionId = sessionIdFromUrl(page)

  const otherContext = await browser.newContext()
  try {
    const other = await otherContext.newPage()
    await other.goto(`/manage/commissioned-ideas/${sessionId}`)
    await expect(other.getByText('Instructor passcode not found.')).toBeVisible()
  } finally {
    await otherContext.close()
  }
})

test('persistent link and Teacher Join open managers that survive a reload', async ({ page, browser }) => {
  const teacherCode = 'commissioned-test-teacher-code'
  const linkResponse = await page.request.post('/api/persistent-session/create', {
    data: {
      activityName: 'commissioned-ideas',
      teacherCode,
      entryPolicy: 'instructor-required',
    },
  })
  expect(linkResponse.ok()).toBe(true)
  const link = await linkResponse.json() as { url: string }

  await page.context().clearCookies()
  await page.goto(link.url)
  await page.getByRole('textbox', { name: 'Teacher code' }).fill(teacherCode)
  await page.getByRole('button', { name: 'Start Activity' }).click()
  await expectManagerReady(page)
  const sessionId = sessionIdFromUrl(page)
  await reloadAndExpectManagerReady(page)

  const secondContext = await browser.newContext()
  try {
    const secondPage = await secondContext.newPage()
    await secondPage.goto('/')
    await secondPage.getByRole('button', { name: 'Teacher Join' }).click()
    await secondPage.getByRole('textbox', { name: 'Join Code', exact: true }).fill(sessionId)
    await secondPage.getByLabel('Teacher code').fill(teacherCode)
    await secondPage.getByRole('button', { name: 'Join as Teacher' }).click()
    await expectManagerReady(secondPage)
    await reloadAndExpectManagerReady(secondPage)
  } finally {
    await secondContext.close()
  }
})

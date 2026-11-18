import { expect, type Page, test } from '@playwright/test'

/**
 * Records the instructor passcode the page sends in its manager-auth socket frame,
 * so storage can be checked for the value itself (never logged). Register before
 * the manager page loads.
 */
function capturePasscode(page: Page): () => string | null {
  let passcode: string | null = null
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.includes('commissioned-ideas:manager-auth')) return
      const value = (JSON.parse(payload) as { instructorPasscode?: unknown }).instructorPasscode
      if (typeof value === 'string' && value.length > 0) passcode = value
    })
  })
  return () => passcode
}

async function expectManagerReady(page: Page, passcode: () => string | null): Promise<void> {
  await expect(page).toHaveURL(/\/manage\/commissioned-ideas\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Session settings' })).toBeVisible()
  await expect(page.getByText('Instructor passcode not found.')).toHaveCount(0)
  await expect.poll(passcode, { message: 'manager authenticated over the socket' }).not.toBeNull()

  // The passcode must not linger in any browser-side store, under any key:
  // session/local storage keys or values, or router state in window.history
  // (cleared after the handoff). The activity-key check covers the sessionStorage opt-out.
  const leaks = await page.evaluate((secret) => {
    const contains = (storage: Storage) =>
      Object.keys(storage).some((key) => key.includes(secret) || (storage.getItem(key) ?? '').includes(secret))
    const historyState = JSON.stringify(window.history.state ?? null)
    return {
      sessionStorageValue: contains(window.sessionStorage),
      localStorageValue: contains(window.localStorage),
      sessionStorageActivityKey: Object.keys(window.sessionStorage).some((key) => key.includes('commissioned-ideas')),
      localStorageActivityKey: Object.keys(window.localStorage).some((key) => key.includes('commissioned-ideas')),
      historyState: historyState.includes('instructorPasscode') || historyState.includes(secret),
    }
  }, passcode() ?? '')
  expect(leaks).toEqual({
    sessionStorageValue: false,
    localStorageValue: false,
    sessionStorageActivityKey: false,
    localStorageActivityKey: false,
    historyState: false,
  })
}

/**
 * A real reload: nothing is re-injected, so recovery must come from the httpOnly
 * manager cookie (possibly after core reissues it from the persistent teacher cookie).
 * Chromium only — WebKit rejects the Secure cookie on the harness HTTP origin;
 * production Safari runs on HTTPS. Same convention as video-sync and syncdeck specs.
 */
async function reloadAndExpectManagerReady(page: Page, passcode: () => string | null): Promise<string[]> {
  if (test.info().project.name !== 'chromium') return []
  const recovery: string[] = []
  const onResponse = (response: { url(): string; status(): number }) => {
    if (response.url().includes('/instructor-passcode')) recovery.push(`exchange ${response.status()}`)
    if (response.url().includes('/persistent-manager-capability')) recovery.push(`reissue ${response.status()}`)
  }
  page.on('response', onResponse)
  try {
    await page.reload()
    await expectManagerReady(page, passcode)
  } finally {
    page.off('response', onResponse)
  }
  expect(recovery.at(-1)).toBe('exchange 200')
  return recovery
}

function sessionIdFromUrl(page: Page): string {
  const sessionId = new URL(page.url()).pathname.split('/').at(-1)
  expect(sessionId).toBeTruthy()
  return sessionId ?? ''
}

test('dashboard creation opens an authenticated manager that survives a reload', async ({ page }) => {
  const passcode = capturePasscode(page)
  await page.goto('/manage')

  const card = page.getByRole('heading', { name: 'Commissioned Ideas' }).locator('../..')
  await card.getByRole('button', { name: 'Start Session Now' }).click()

  await expectManagerReady(page, passcode)
  await reloadAndExpectManagerReady(page, passcode)
})

test('a browser without the manager cookie cannot recover the passcode', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit rejects the Secure manager cookie on the harness HTTP origin; production Safari runs on HTTPS.')
  const passcode = capturePasscode(page)
  await page.goto('/manage')
  const card = page.getByRole('heading', { name: 'Commissioned Ideas' }).locator('../..')
  await card.getByRole('button', { name: 'Start Session Now' }).click()
  await expectManagerReady(page, passcode)
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
  const passcode = capturePasscode(page)
  await page.goto(link.url)
  await page.getByRole('textbox', { name: 'Teacher code' }).fill(teacherCode)
  await page.getByRole('button', { name: 'Start Activity' }).click()
  await expectManagerReady(page, passcode)
  const sessionId = sessionIdFromUrl(page)
  await reloadAndExpectManagerReady(page, passcode)

  // Lose only the manager capability cookie; the persistent teacher cookie remains.
  // Reload must reissue the capability from it for real: 403, reissue, then 200.
  if (test.info().project.name === 'chromium') {
    await page.context().clearCookies({ name: /^activebits_cap_manager_/ })
    const recovery = await reloadAndExpectManagerReady(page, passcode)
    expect(recovery).toEqual(['exchange 403', 'reissue 200', 'exchange 200'])
  }

  const secondContext = await browser.newContext()
  try {
    const secondPage = await secondContext.newPage()
    const secondPasscode = capturePasscode(secondPage)
    await secondPage.goto('/')
    await secondPage.getByRole('button', { name: 'Teacher Join' }).click()
    await secondPage.getByRole('textbox', { name: 'Join Code', exact: true }).fill(sessionId)
    await secondPage.getByLabel('Teacher code').fill(teacherCode)
    await secondPage.getByRole('button', { name: 'Join as Teacher' }).click()
    await expectManagerReady(secondPage, secondPasscode)
    await reloadAndExpectManagerReady(secondPage, secondPasscode)
  } finally {
    await secondContext.close()
  }
})

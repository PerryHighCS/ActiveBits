import { expect, type Page, test } from '@playwright/test'

async function expectManagerReady(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/manage\/commissioned-ideas\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Session settings' })).toBeVisible()
  await expect(page.getByText('Instructor passcode not found.')).toHaveCount(0)

  const hasPasscodeInStorage = await page.evaluate(() =>
    Object.keys(window.sessionStorage).some((key) => key.includes('commissioned-ideas')),
  )
  expect(hasPasscodeInStorage).toBe(false)
}

test('dashboard creation opens an authenticated Commissioned Ideas manager', async ({ page }) => {
  await page.goto('/manage')

  const card = page.getByRole('heading', { name: 'Commissioned Ideas' }).locator('../..')
  await card.getByRole('button', { name: 'Start Session Now' }).click()

  await expectManagerReady(page)
})

test('persistent link and Teacher Join open authenticated managers', async ({ page, browser }) => {
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
  const sessionId = new URL(page.url()).pathname.split('/').at(-1)
  expect(sessionId).toBeTruthy()

  const secondContext = await browser.newContext()
  try {
    const secondPage = await secondContext.newPage()
    await secondPage.goto('/')
    await secondPage.getByRole('button', { name: 'Teacher Join' }).click()
    await secondPage.getByRole('textbox', { name: 'Join Code', exact: true }).fill(sessionId ?? '')
    await secondPage.getByLabel('Teacher code').fill(teacherCode)
    await secondPage.getByRole('button', { name: 'Join as Teacher' }).click()
    await expectManagerReady(secondPage)
  } finally {
    await secondContext.close()
  }
})

import { expect, type Page, test } from '@playwright/test'

interface MobCodeCreateResponse {
  id: string
  instructorPasscode: string
}

async function createMobCodeSession(page: Page): Promise<MobCodeCreateResponse> {
  const response = await page.request.post('/api/mobcode/create')
  expect(response.ok()).toBe(true)
  return await response.json() as MobCodeCreateResponse
}

async function seedMobCodeFile(page: Page, session: MobCodeCreateResponse, source: string): Promise<void> {
  const response = await page.request.post(`/api/mobcode/${encodeURIComponent(session.id)}/state`, {
    data: {
      files: { 'test.py': source },
      activeFile: 'test.py',
      instructorPasscode: session.instructorPasscode,
      messageType: 'file-tree-changed',
    },
  })
  expect(response.ok()).toBe(true)
}

async function openMobCodeManager(page: Page, session: MobCodeCreateResponse): Promise<void> {
  await page.addInitScript(({ instructorPasscode }) => {
    window.history.replaceState(
      {
        usr: { createSessionPayload: { instructorPasscode } },
        key: 'mobcode-playwright',
        idx: 0,
      },
      '',
      window.location.href,
    )
  }, { instructorPasscode: session.instructorPasscode })
  await page.goto(`/manage/mobcode/${encodeURIComponent(session.id)}`)
  await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled()
}

async function runMobCodePopup(page: Page): Promise<Page> {
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Run' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  await expect(popup.getByText('[Python] Running test.py')).toBeVisible({ timeout: 15_000 })
  return popup
}

test('MobCode Python runner popup prints terminal output', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'print("hello from playwright")\n')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopup(page)

  await expect(popup.locator('#terminal')).toContainText('hello from playwright', { timeout: 15_000 })
  await expect(popup.getByRole('button', { name: 'Stop Python runner' })).toHaveText('Done')
})

test('MobCode Python runner popup handles terminal input', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'name = input("Name? ")\nprint("Hello " + name)\n')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopup(page)

  await expect(popup.locator('#terminal')).toContainText('Name?', { timeout: 15_000 })
  await popup.getByLabel('Program input').fill('Ada')
  await popup.getByLabel('Program input').press('Enter')
  await expect(popup.locator('#terminal')).toContainText('Hello Ada', { timeout: 15_000 })
})

test('MobCode Python runner popup reports unsupported imports without Brython DOMException noise', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'import timey\nprint("never")\n')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopup(page)
  const terminal = popup.locator('#terminal')

  await expect(terminal).toContainText('Error in test.py, line 1', { timeout: 15_000 })
  await expect(terminal).toContainText("ImportError: Module 'timey' is not available in the terminal runner.")
  await expect(terminal).not.toContainText('JSObject')
  await expect(terminal).not.toContainText('DOMException')
})

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

async function openMobCodeStudent(page: Page, session: MobCodeCreateResponse): Promise<void> {
  await page.goto(`/${encodeURIComponent(session.id)}`)
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

test('MobCode student view launches the instructor-selected Python runner', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'print("hello from student")\n')
  await openMobCodeStudent(page, session)

  await expect(page.getByLabel('Runner implementation')).toHaveCount(0)
  const popup = await runMobCodePopup(page)
  await expect(popup.locator('#terminal')).toContainText('hello from student', { timeout: 15_000 })
})

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
  await popup.locator('#terminal').evaluate((terminal) => {
    const input = terminal.querySelector('input')
    if (input instanceof HTMLInputElement) {
      input.blur()
    }
  })
  await popup.locator('#terminal').click({ position: { x: 20, y: 20 } })
  await expect(popup.getByLabel('Program input')).toBeFocused()
  await popup.keyboard.type('Ada')
  await popup.keyboard.press('Enter')
  await expect(popup.locator('#terminal')).toContainText('Hello Ada', { timeout: 15_000 })
})

test('MobCode Python runner popup autoscrolls terminal output under a fixed header', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'for i in range(120):\n    print("scroll-line " + str(i))\n')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopup(page)
  const terminal = popup.locator('#terminal')

  await expect(terminal).toContainText('scroll-line 119', { timeout: 15_000 })
  const metrics = await terminal.evaluate((element) => {
    const header = document.querySelector('header')
    return {
      bodyScrollTop: document.scrollingElement?.scrollTop ?? 0,
      headerTop: header?.getBoundingClientRect().top ?? -1,
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }
  })
  expect(metrics.bodyScrollTop).toBe(0)
  expect(metrics.headerTop).toBe(0)
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  expect(metrics.scrollTop + metrics.clientHeight).toBeGreaterThanOrEqual(metrics.scrollHeight - 2)
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

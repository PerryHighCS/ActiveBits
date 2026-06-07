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
  await seedMobCodeFiles(page, session, { 'test.py': source }, 'test.py')
}

async function seedMobCodeFiles(
  page: Page,
  session: MobCodeCreateResponse,
  files: Record<string, string>,
  activeFile: string,
): Promise<void> {
  const response = await page.request.post(`/api/mobcode/${encodeURIComponent(session.id)}/state`, {
    data: {
      files,
      activeFile,
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
  return await runMobCodePopupForEntry(page, 'test.py')
}

async function runMobCodePopupForEntry(page: Page, entryFile: string): Promise<Page> {
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Run' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  await expect(popup.getByText(`[Python] Running ${entryFile}`)).toBeVisible({ timeout: 15_000 })
  return popup
}

async function clickRunnerDoneAndWaitForClose(popup: Page): Promise<void> {
  const closePromise = popup.waitForEvent('close')
  try {
    await popup.getByRole('button', { name: 'Close Python runner' }).click()
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Target page, context or browser has been closed')) {
      throw error
    }
  }
  await closePromise
}

test('MobCode student view launches the instructor-selected Python runner', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'print("hello from student")\n')
  await openMobCodeStudent(page, session)

  await expect(page.getByLabel('Runner implementation')).toHaveCount(0)
  const popup = await runMobCodePopup(page)
  await expect(popup.locator('#terminal')).toContainText('hello from student', { timeout: 15_000 })
})

test('MobCode student runner status is announced as an alert', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFiles(page, session, { 'README.md': 'not python' }, 'README.md')
  await openMobCodeStudent(page, session)

  await page.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('alert')).toHaveText('Add or select a Python file before running it.')
})

test('MobCode Python runner popup prints terminal output', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'print("hello from playwright")\n')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopup(page)

  await expect(popup.locator('#terminal')).toContainText('hello from playwright', { timeout: 15_000 })
  await expect(popup.getByRole('button', { name: 'Close Python runner' })).toHaveText('Done')
  await clickRunnerDoneAndWaitForClose(popup)
})

test('MobCode Python runner popup imports workspace Python modules', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFiles(page, session, {
    'main.py': 'from greeter import Greeter\n\ng = Greeter()\nprint(g.greet("World"))\n',
    'greeter.py': 'class Greeter:\n    def greet(self, name):\n        return f"Hello, {name}!"\n',
    'README.md': 'Expected output: `Hello, World!` and ${not_js}\n',
  }, 'main.py')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopupForEntry(page, 'main.py')
  const terminal = popup.locator('#terminal')

  await expect(terminal).toContainText('Hello, World!', { timeout: 15_000 })
  await expect(terminal).not.toContainText('Invalid URL')
  await expect(terminal).not.toContainText('XMLHttpRequest')
})

test('MobCode Python runner popup closes from the stopped state', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'print("ready")\n')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopup(page)

  await expect(popup.locator('#terminal')).toContainText('ready', { timeout: 15_000 })
  await popup.evaluate(() => {
    (window as unknown as { mobcodeRunnerSetState: (state: string) => void }).mobcodeRunnerSetState('stopped')
  })
  await expect(popup.getByRole('button', { name: 'Close Python runner' })).toHaveText('Done')
  await clickRunnerDoneAndWaitForClose(popup)
})

test('MobCode Python runner popup handles terminal input', async ({ page }) => {
  const session = await createMobCodeSession(page)
  await seedMobCodeFile(page, session, 'name = input("Name? ")\nprint("Hello " + name)\n')
  await openMobCodeManager(page, session)

  const popup = await runMobCodePopup(page)

  await expect(popup.locator('#terminal')).toContainText('Name?', { timeout: 15_000 })
  await expect(popup.getByRole('button', { name: 'Stop Python runner' })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Close Python runner' })).toHaveCount(0)
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

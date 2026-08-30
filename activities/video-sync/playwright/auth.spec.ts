import { expect, test } from '@playwright/test'

test('Video Sync manager recovers from its httpOnly capability cookie without a passcode handoff', async ({ browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')
  const context = await browser.newContext()
  const page = await context.newPage()
  const created = await page.request.post('/api/video-sync/create')
  expect(created.ok()).toBe(true)
  const { id: sessionId } = await created.json() as { id: string }

  await page.goto(`/manage/video-sync/${encodeURIComponent(sessionId)}`)
  await expect(page.getByRole('heading', { name: 'Step 1: Configure video source' })).toBeVisible()
  await expect(page.getByText('Live updates unavailable. Attempting reconnect...')).toHaveCount(0)

  await page.close()
  await context.close()
})

test('Video Sync temporary manager becomes read-only after its capability cookie is lost', async ({ browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  const created = await page.evaluate(async () => {
    const response = await fetch('/api/video-sync/create', { method: 'POST', credentials: 'include' })
    if (!response.ok) {
      throw new Error(`Unable to create Video Sync session: ${response.status}`)
    }
    return response.json() as Promise<{ id?: unknown }>
  })
  expect(typeof created.id).toBe('string')
  const sessionId = created.id as string

  await context.clearCookies({ name: `activebits_cap_manager_${Buffer.from(sessionId, 'utf8').toString('base64url')}` })
  await page.goto(`/manage/video-sync/${encodeURIComponent(sessionId)}`)

  await expect(page.getByRole('heading', { name: 'Step 1: Configure video source' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Instructor access unavailable' })).toBeDisabled()

  await page.close()
  await context.close()
})

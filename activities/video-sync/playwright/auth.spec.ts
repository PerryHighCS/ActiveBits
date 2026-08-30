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

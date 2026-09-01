import { expect, test } from '@playwright/test'

// Issue #364: an instructor pause must not be silently reverted by the 3s
// heartbeat. This drives the real routing + fetch + websocket + heartbeat path
// and asserts on the manager status bar, whose "Playing:" text is bound purely
// to the websocket `state` (independent of the YouTube iframe loading), so the
// check is stable even where youtube-nocookie.com is unreachable from CI.
test('Video Sync instructor pause stays paused across multiple heartbeat intervals', async ({ browser }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit request contexts do not retain Set-Cookie responses in this harness.')

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')

  // The manager capability cookie is issued Secure; a browser-context fetch to
  // 127.0.0.1 sends it, the Node request context does not - so every call goes
  // through the page.
  const sessionId = await page.evaluate(async () => {
    const response = await fetch('/api/video-sync/create', { method: 'POST', credentials: 'include' })
    if (!response.ok) {
      throw new Error(`create failed: ${response.status}`)
    }
    const body = await response.json() as { id: string }
    return body.id
  })

  const command = async (path: string, payload: Record<string, unknown>): Promise<number> =>
    page.evaluate(async ({ url, body }) => {
      const response = await fetch(url, {
        method: body.method as string,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.data),
      })
      return response.status
    }, { url: path, body: payload })

  expect(await command(`/api/video-sync/${sessionId}/session`, {
    method: 'PATCH',
    data: { sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  })).toBe(200)

  await page.goto(`/manage/video-sync/${encodeURIComponent(sessionId)}`)

  const managerStatus = page.locator('[aria-live="polite"]')
  await expect(managerStatus).toContainText('Playing: No')

  // Play, then pause - mirroring an instructor clicking the controls.
  expect(await command(`/api/video-sync/${sessionId}/command`, { method: 'POST', data: { type: 'play' } })).toBe(200)
  await expect(managerStatus).toContainText('Playing: Yes')

  expect(await command(`/api/video-sync/${sessionId}/command`, { method: 'POST', data: { type: 'pause' } })).toBe(200)
  await expect(managerStatus).toContainText('Playing: No')

  // Hold across >= 2 heartbeat intervals (3s each): a stale heartbeat frame must
  // not resume playback on the client.
  await page.waitForTimeout(7_000)
  await expect(managerStatus).toContainText('Playing: No')
  await expect(page.getByText('Live updates unavailable. Attempting reconnect...')).toHaveCount(0)

  await page.close()
  await context.close()
})

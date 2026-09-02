import { expect, test } from '@playwright/test'

// Issue #364: an instructor pause must not be silently reverted by the 3s
// heartbeat. This drives the real routing + fetch + websocket + heartbeat path
// and asserts on the manager status bar, whose "Playing:" text is bound purely
// to the websocket `state` (independent of the YouTube iframe loading), so the
// check is stable even where youtube-nocookie.com is unreachable from CI.
//
// Playback uses activity-owned controls; the YouTube iframe is a projection so
// buffering/autoplay events from another manager cannot become commands.
test('Video Sync instructor pause stays paused across multiple heartbeat intervals', async ({ browser }) => {
  test.skip(test.info().project.name === 'webkit', 'WebKit rejects the Secure manager cookie on the harness HTTP origin; production Safari runs on HTTPS.')

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

  const command = async (path: string, method: string, data: Record<string, unknown>): Promise<number> =>
    page.evaluate(async ({ url, verb, body }) => {
      const response = await fetch(url, {
        method: verb,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return response.status
    }, { url: path, verb: method, body: data })

  expect(await command(`/api/video-sync/${sessionId}/session`, 'PATCH', {
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  })).toBe(200)

  // Count heartbeat frames on the manager's websocket so the "held across >= 2
  // intervals" check waits on observed heartbeats, not elapsed wall time.
  let heartbeatFrames = 0
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string' && frame.payload.includes('"type":"heartbeat"')) {
        heartbeatFrames += 1
      }
    })
  })

  await page.goto(`/manage/video-sync/${encodeURIComponent(sessionId)}`)
  const secondaryManager = await context.newPage()
  await secondaryManager.goto(`/manage/video-sync/${encodeURIComponent(sessionId)}`)

  // The status-bar span is the only element carrying "Playing:" text; scope to it
  // so the amber autoplay-blocked notice (also aria-live) can't be matched here.
  const managerStatus = page.getByText('Playing:')
  const secondaryStatus = secondaryManager.getByText('Playing:')
  await expect(managerStatus).toContainText('Playing: No')
  await expect(secondaryStatus).toContainText('Playing: No')

  // The centered activity-owned button covers YouTube's misleading native play
  // affordance and is the sole click target over the manager iframe.
  await page.getByRole('button', { name: 'Play synchronized video' }).click()
  await expect(managerStatus).toContainText('Playing: Yes')
  await expect(secondaryStatus).toContainText('Playing: Yes')

  await secondaryManager.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(managerStatus).toContainText('Playing: No')
  await expect(secondaryStatus).toContainText('Playing: No')

  // Activity-owned seek: the position it commits propagates to every manager via
  // the same websocket `state` the status bar renders.
  await page.getByRole('spinbutton', { name: 'Seek to position in seconds' }).fill('30')
  await page.getByRole('button', { name: 'Seek', exact: true }).click()
  await expect(page.getByText('Position:')).toContainText('Position: 30.00s')
  await expect(secondaryManager.getByText('Position:')).toContainText('Position: 30.00s')

  // Gesture order: a Play immediately followed by a Seek must serialize so the
  // Seek wins - the session lands paused at the sought position, not playing.
  await page.getByRole('spinbutton', { name: 'Seek to position in seconds' }).fill('45')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.getByRole('button', { name: 'Seek', exact: true }).click()
  await expect(page.getByText('Position:')).toContainText('Position: 45.00s')
  await expect(managerStatus).toContainText('Playing: No')
  await expect(secondaryStatus).toContainText('Playing: No')

  const framesAtPause = heartbeatFrames
  // Wait for >= 2 further heartbeat frames (3s cadence): a stale heartbeat frame
  // must not resume playback on the client.
  await expect.poll(() => heartbeatFrames - framesAtPause, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
  await expect(managerStatus).toContainText('Playing: No')
  await expect(page.getByText('Live updates unavailable. Attempting reconnect...')).toHaveCount(0)

  await page.close()
  await secondaryManager.close()
  await context.close()
})

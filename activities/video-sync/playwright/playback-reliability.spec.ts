import { expect, test } from '@playwright/test'

// Issue #364: an instructor pause must not be silently reverted by the 3s
// heartbeat. This drives the real routing + fetch + websocket + heartbeat path
// and asserts on the manager status bar, whose "Playing:" text is bound purely
// to the websocket `state` (independent of the YouTube iframe loading), so the
// check is stable even where youtube-nocookie.com is unreachable from CI.
//
// The instructor's playback controls are the embedded YouTube iframe control
// bar (cross-origin, external), so play/pause here go through the REST
// `/command` path rather than iframe clicks; the manager-side echo-suppression /
// retry logic (Defect 1) is covered by unit tests on the pure helpers.
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

  // The status-bar span is the only element carrying "Playing:" text; scope to it
  // so the amber autoplay-blocked notice (also aria-live) can't be matched here.
  const managerStatus = page.getByText('Playing:')
  await expect(managerStatus).toContainText('Playing: No')

  expect(await command(`/api/video-sync/${sessionId}/command`, 'POST', { type: 'play' })).toBe(200)
  await expect(managerStatus).toContainText('Playing: Yes')

  expect(await command(`/api/video-sync/${sessionId}/command`, 'POST', { type: 'pause' })).toBe(200)
  await expect(managerStatus).toContainText('Playing: No')

  const framesAtPause = heartbeatFrames
  // Wait for >= 2 further heartbeat frames (3s cadence): a stale heartbeat frame
  // must not resume playback on the client.
  await expect.poll(() => heartbeatFrames - framesAtPause, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
  await expect(managerStatus).toContainText('Playing: No')
  await expect(page.getByText('Live updates unavailable. Attempting reconnect...')).toHaveCount(0)

  await page.close()
  await context.close()
})

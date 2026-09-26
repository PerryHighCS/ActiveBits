import { expect, test, type Page } from '@playwright/test'

const PRESENTATION_URL = 'https://slides.example/solo-deck'
const SOLO_QUESTION_TEXT = 'Solo question for the bound child'

// A stand-in reveal.js deck: it reports slide 0:0 and requests a Resonance
// solo overlay there, repeating briefly so the student page can attach first.
const STUB_DECK_HTML = `<!doctype html><html><body><p>Stub deck</p><script>
  const post = (action, payload) => window.parent.postMessage({ type: 'reveal-sync', version: '2.0.0', action, payload }, '*')
  let sent = 0
  const timer = setInterval(() => {
    post('ready', { indices: { h: 0, v: 0, f: 0 } })
    post('state', { indices: { h: 0, v: 0, f: 0 } })
    post('activityRequest', {
      activityId: 'resonance',
      indices: { h: 0, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: false, supportsPermalink: true },
      activityOptions: { questions: [{ id: 'q1', type: 'free-response', text: ${JSON.stringify(SOLO_QUESTION_TEXT)}, order: 0 }] },
    })
    if (++sent >= 20) clearInterval(timer)
  }, 250)
</script></body></html>`

async function createStandaloneDeck(page: Page): Promise<string> {
  const created = await page.request.post('/api/syncdeck/create')
  expect(created.ok()).toBeTruthy()
  const { id, instructorPasscode } = await created.json() as { id: string; instructorPasscode: string }
  const configured = await page.request.post(`/api/syncdeck/${id}/configure`, {
    data: { instructorPasscode, presentationUrl: PRESENTATION_URL, standaloneMode: true },
  })
  expect(configured.ok()).toBeTruthy()
  return id
}

function soloChildFrame(page: Page) {
  return page.locator('iframe[src^="/CHILD"]').first()
}

test.describe('SyncDeck solo child launch in a real browser', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'WebKit request contexts do not retain Set-Cookie responses in this harness.',
  )

  test('a standalone student gets a server-bound Resonance solo child that survives reload', async ({ page }) => {
    await page.route(`${PRESENTATION_URL}**`, async (route) => {
      await route.fulfill({ contentType: 'text/html', body: STUB_DECK_HTML })
    })
    const sessionId = await createStandaloneDeck(page)
    const startRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/solo-activity/start')) startRequests.push(request.method())
    })

    await page.goto(`/${encodeURIComponent(sessionId)}`)
    await page.getByLabel('Display Name *').fill('Ada')
    await page.getByRole('button', { name: 'Join Session' }).click()

    const soloFrame = soloChildFrame(page)
    await expect(soloFrame).toBeVisible({ timeout: 15_000 })
    const childSrc = await soloFrame.getAttribute('src')
    expect(decodeURIComponent(childSrc ?? '')).toMatch(new RegExp(`^/CHILD:${sessionId}:[0-9a-f]+:resonance$`))
    // The handoff admits the student directly; no second name prompt in the child.
    const child = page.frameLocator('iframe[src^="/CHILD"]')
    await expect(child.getByText(SOLO_QUESTION_TEXT)).toBeVisible({ timeout: 15_000 })
    await expect(child.getByLabel('Display Name *')).toHaveCount(0)
    expect(startRequests).toContain('POST')

    await page.reload()
    await expect(soloChildFrame(page)).toBeVisible({ timeout: 15_000 })
    // Same slide, same options, same student: the server reuses the bound child.
    await expect(soloChildFrame(page)).toHaveAttribute('src', childSrc ?? '')
    await expect(page.frameLocator('iframe[src^="/CHILD"]').getByText(SOLO_QUESTION_TEXT)).toBeVisible({ timeout: 15_000 })
  })
})

import { expect, test } from '@playwright/test'

// A persistent SyncDeck permalink must hand the student to the created session
// through the session-scoped entry handoff, whose consume sets the accepted-entry
// cookie that SyncDeck's student routes and WebSocket admission require.
test('persistent SyncDeck solo entry establishes the accepted-entry cookie for the created session', async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new Error('Playwright baseURL must be configured for persistent SyncDeck entry coverage.')
  }

  const teacherContext = await browser.newContext({ baseURL })
  const generated = await teacherContext.request.post('/api/syncdeck/generate-url', {
    data: {
      activityName: 'syncdeck',
      teacherCode: 'persistent-entry-test',
      entryPolicy: 'solo-only',
      selectedOptions: { presentationUrl: 'https://slides.example/deck' },
    },
  })
  expect(generated.ok()).toBeTruthy()
  const { url } = await generated.json() as { url: string }
  await teacherContext.close()

  const studentContext = await browser.newContext({ baseURL })
  const page = await studentContext.newPage()
  await page.route('https://slides.example/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>deck</title>' }))
  await page.goto(url)
  await page.locator('#waiting-room-field-displayName').fill('Ada')
  const consumed = page.waitForResponse((response) => /\/api\/session\/[^/]+\/entry-participant\/consume$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Continue in Solo Mode' }).click()

  await page.waitForURL((current) => /^\/[^/]+$/.test(current.pathname) && !current.pathname.startsWith('/activity'))
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.slice(1))
  await expect(page.getByRole('heading', { name: 'Return to Waiting Room' })).toHaveCount(0)

  // Consuming the session-scoped handoff issued the accepted-entry cookie.
  const consumeResponse = await consumed
  expect(consumeResponse.ok()).toBeTruthy()
  expect(new URL(consumeResponse.url()).pathname).toBe(`/api/session/${encodeURIComponent(sessionId)}/entry-participant/consume`)
  const participantCookieName = `activebits_participant_${Buffer.from(sessionId, 'utf8').toString('base64url')}`
  const cookiePair = (await consumeResponse.headerValue('set-cookie'))?.split('\n')
    .map((line) => line.split(';', 1)[0]!)
    .find((pair) => pair.startsWith(`${participantCookieName}=`))
  expect(cookiePair).toBeTruthy()
  // The test server issues production Secure cookies on local HTTP, which WebKit
  // does not store and the API request context does not send; install the same
  // issued token as a local cookie.
  await studentContext.addCookies([{
    name: participantCookieName,
    value: cookiePair!.slice(participantCookieName.length + 1),
    url: new URL(consumeResponse.url()).origin,
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
  }])
  // With the cookie, a reload bypasses the waiting room and resumes the student
  // instead of prompting for reentry. (A standalone session opens no instructor
  // socket, so there is no connection status to assert.)
  await page.reload()
  await expect(page.getByText('SyncDeck')).not.toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Return to Waiting Room' })).toHaveCount(0)
  await expect(page.locator('#waiting-room-field-displayName')).toHaveCount(0)

  // The session recognizes the student from the accepted-entry cookie alone.
  await expect.poll(async () => {
    const response = await page.request.get(`/api/syncdeck/${encodeURIComponent(sessionId)}/student-identity`)
    return response.ok() ? (await response.json() as { displayName: string | null }).displayName : response.status()
  }).toBe('Ada')

  await studentContext.close()
})

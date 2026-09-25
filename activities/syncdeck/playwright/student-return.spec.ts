import { expect, test, type Page, type Route } from '@playwright/test'

async function createInstructorSession(page: Page): Promise<{ id: string; instructorPasscode: string }> {
  const response = await page.request.post('/api/syncdeck/create')
  expect(response.ok()).toBeTruthy()
  return await response.json() as { id: string; instructorPasscode: string }
}

async function acceptStudent(page: Page, sessionId: string, displayName: string): Promise<string> {
  // Both joins claim the same client ID. The public store must mint distinct IDs.
  const stored = await page.request.post(`/api/session/${sessionId}/entry-participant`, {
    data: { values: { displayName, participantId: 'claimed-by-client' } },
  })
  const { entryParticipantToken, values } = await stored.json() as {
    entryParticipantToken: string
    values: { participantId: string }
  }
  expect(values.participantId).not.toBe('claimed-by-client')
  const consumed = await page.request.post(`/api/session/${sessionId}/entry-participant/consume`, { data: { token: entryParticipantToken } })
  expect(consumed.ok()).toBeTruthy()
  const cookiePair = consumed.headers()['set-cookie']?.split(';', 1)[0]
  expect(cookiePair).toBeTruthy()
  const separator = cookiePair!.indexOf('=')
  expect(separator).toBeGreaterThan(0)
  // The test server issues production Secure cookies on local HTTP. WebKit does
  // not send those on ws://, so install the same issued token as a local cookie.
  await page.context().addCookies([{
    name: cookiePair!.slice(0, separator),
    value: cookiePair!.slice(separator + 1),
    url: new URL(consumed.url()).origin,
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
  }])
  return values.participantId
}

// Open the student sockets one at a time. The SyncDeck join handler does an
// async read-modify-write of the session roster, so two sockets opened in the
// same tick can race and drop one roster entry (worse on WebKit timing). A
// socket's open event and the connected-count update can both precede the
// persisted roster update; wait for each rendered row before opening the next
// socket. The underlying cross-handler write race is tracked in
// https://github.com/PerryHighCS/ActiveBits/issues/350.
async function connectSyncDeckStudentSocket(page: Page, sessionId: string, studentId: string): Promise<void> {
  await page.evaluate(({ sessionId, studentId }) => new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/syncdeck?sessionId=${encodeURIComponent(sessionId)}&studentId=${encodeURIComponent(studentId)}`)
    const store = window as unknown as { __syncDeckStudentSockets?: WebSocket[] }
    store.__syncDeckStudentSockets = store.__syncDeckStudentSockets ?? []
    store.__syncDeckStudentSockets.push(ws)
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error(`SyncDeck student socket failed to open for ${studentId}`)))
  }), { sessionId, studentId })
}

test('SyncDeck manager boots a roster student through the rendered panel action', async ({ page }) => {
  const session = await createInstructorSession(page)
  const configured = await page.request.post(`/api/syncdeck/${session.id}/configure`, {
    data: { instructorPasscode: session.instructorPasscode, presentationUrl: 'https://slides.example/deck' },
  })
  expect(configured.ok()).toBeTruthy()
  const adaId = await acceptStudent(page, session.id, 'Ada')
  await page.addInitScript(({ instructorPasscode }) => {
    window.history.replaceState(
      {
        usr: { createSessionPayload: { instructorPasscode } },
        key: 'syncdeck-student-return',
        idx: 0,
      },
      '',
      window.location.href,
    )
  }, { instructorPasscode: session.instructorPasscode })
  await page.goto(`/manage/syncdeck/${session.id}`)
  await expect(page.getByRole('button', { name: 'Students: 0' })).toBeVisible()
  await page.getByRole('button', { name: /Students:/ }).click()
  await connectSyncDeckStudentSocket(page, session.id, adaId)
  await expect(page.getByRole('button', { name: 'Students: 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeVisible()
  const linId = await acceptStudent(page, session.id, 'Lin')
  await connectSyncDeckStudentSocket(page, session.id, linId)
  await expect(page.getByRole('button', { name: 'Students: 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return Lin to the waiting room' })).toBeVisible()

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Return Ada to the waiting room' }).click()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeEnabled()

  let pendingRoute: Route | null = null
  await page.route(`**/students/${adaId}/return-to-waiting-room`, async (route) => {
    pendingRoute = route
  })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Return Ada to the waiting room' }).click()
  await expect.poll(() => pendingRoute !== null).toBeTruthy()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Return Lin to the waiting room' })).toBeDisabled()
  await pendingRoute!.fulfill({ status: 500, body: '{}' })
  await expect(page.getByRole('alert')).toContainText('Unable to return this student')

  await page.unrouteAll()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Return Ada to the waiting room' }).click()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Return Lin to the waiting room' })).toBeVisible()
})

test('SyncDeck student with a stale stored ID recovers the accepted-entry identity after reload', async ({ page }) => {
  const session = await createInstructorSession(page)
  const configured = await page.request.post(`/api/syncdeck/${session.id}/configure`, {
    data: { instructorPasscode: session.instructorPasscode, presentationUrl: 'https://slides.example/deck' },
  })
  expect(configured.ok()).toBeTruthy()
  await page.route('https://slides.example/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>deck</title>' }))
  const adaId = await acceptStudent(page, session.id, 'Ada')
  // A stale identity persisted by an earlier entry in this browser. With a valid
  // accepted-entry cookie, /entry skips the waiting room, so the socket rejects
  // this ID as 'forbidden'; the client must adopt the cookie's student instead.
  await page.addInitScript(({ sessionId }) => {
    if (window.localStorage.getItem('__staleSeeded') === '1') return
    window.localStorage.setItem('__staleSeeded', '1')
    window.localStorage.setItem(`session-participant:${sessionId}`, JSON.stringify({ studentName: 'Ada', studentId: 'stale-student' }))
    window.localStorage.setItem(`student-name-${sessionId}`, 'Ada')
    window.localStorage.setItem(`student-id-${sessionId}`, 'stale-student')
  }, { sessionId: session.id })

  await page.goto(`/${session.id}`)
  await expect.poll(() => page.evaluate((sessionId) => window.localStorage.getItem(`student-id-${sessionId}`), session.id)).toBe(adaId)
  await expect(page.getByRole('heading', { name: 'Return to Waiting Room' })).toHaveCount(0)

  // The recovered identity survives a reload instead of looping on the stale ID.
  await page.reload()
  await expect.poll(() => page.evaluate((sessionId) => window.localStorage.getItem(`student-id-${sessionId}`), session.id)).toBe(adaId)
  await expect(page.getByRole('heading', { name: 'Return to Waiting Room' })).toHaveCount(0)
})

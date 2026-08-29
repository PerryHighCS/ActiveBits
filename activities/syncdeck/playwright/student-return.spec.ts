import { expect, test, type Page, type Route } from '@playwright/test'

async function createInstructorSession(page: Page): Promise<{ id: string; instructorPasscode: string }> {
  const response = await page.request.post('/api/syncdeck/create')
  expect(response.ok()).toBeTruthy()
  return await response.json() as { id: string; instructorPasscode: string }
}

// Identity is server-issued: the waiting-room store mints the participantId and
// ignores any request-supplied one, so return the minted id for the caller to
// use on the student socket.
async function acceptStudent(page: Page, sessionId: string, displayName: string): Promise<string> {
  const stored = await page.request.post(`/api/session/${sessionId}/entry-participant`, { data: { values: { displayName } } })
  const { entryParticipantToken, values } = await stored.json() as { entryParticipantToken: string; values: { participantId: string } }
  await page.request.post(`/api/session/${sessionId}/entry-participant/consume`, { data: { token: entryParticipantToken } })
  return values.participantId
}

// Open the student sockets one at a time. The SyncDeck join handler does an
// async read-modify-write of the session roster, so two sockets opened in the
// same tick can race and drop one roster entry (worse on WebKit timing). Real
// students never join within one tick; waiting for each to appear keeps the
// multi-client assertion retry-stable. The underlying cross-handler write race
// is tracked in https://github.com/PerryHighCS/ActiveBits/issues/350.
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
  const linId = await acceptStudent(page, session.id, 'Lin')
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
  await connectSyncDeckStudentSocket(page, session.id, adaId)
  await expect(page.getByRole('button', { name: 'Students: 1' })).toBeVisible()
  await connectSyncDeckStudentSocket(page, session.id, linId)
  await expect(page.getByRole('button', { name: 'Students: 2' })).toBeVisible()
  await page.getByRole('button', { name: /Students:/ }).click()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeVisible()
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

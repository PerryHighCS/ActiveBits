import { expect, test, type Page, type Route } from '@playwright/test'

async function createInstructorSession(page: Page): Promise<{ id: string; instructorPasscode: string }> {
  const response = await page.request.post('/api/syncdeck/create')
  expect(response.ok()).toBeTruthy()
  return await response.json() as { id: string; instructorPasscode: string }
}

async function acceptStudent(page: Page, sessionId: string, participantId: string, displayName: string): Promise<void> {
  const stored = await page.request.post(`/api/session/${sessionId}/entry-participant`, { data: { values: { participantId, displayName } } })
  const { entryParticipantToken } = await stored.json() as { entryParticipantToken: string }
  await page.request.post(`/api/session/${sessionId}/entry-participant/consume`, { data: { token: entryParticipantToken } })
}

// The participant auth cookie issued by entry-participant/consume is scoped per
// session, not per participant, matching one real student per browser. Each
// simulated student therefore needs its own browser context so its cookie and
// WebSocket connection stay attached to its own identity instead of colliding.
async function connectStudentSocket(page: Page, sessionId: string, studentId: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(({ sessionId, studentId }) => new Promise<void>((resolve) => {
    const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/syncdeck?sessionId=${encodeURIComponent(sessionId)}&studentId=${studentId}`)
    ws.addEventListener('open', () => resolve())
    Object.assign(window, { __syncDeckStudentSocket: ws })
  }), { sessionId, studentId })
}

test('SyncDeck manager boots a roster student through the rendered panel action', async ({ page, browser }) => {
  const session = await createInstructorSession(page)
  const configured = await page.request.post(`/api/syncdeck/${session.id}/configure`, {
    data: { instructorPasscode: session.instructorPasscode, presentationUrl: 'https://slides.example/deck' },
  })
  expect(configured.ok()).toBeTruthy()

  const adaPage = await browser.newPage()
  const linPage = await browser.newPage()
  await acceptStudent(adaPage, session.id, 'student-1', 'Ada')
  await acceptStudent(linPage, session.id, 'student-2', 'Lin')

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
  await connectStudentSocket(adaPage, session.id, 'student-1')
  await connectStudentSocket(linPage, session.id, 'student-2')
  await expect(page.getByRole('button', { name: 'Students: 2' })).toBeVisible()
  await page.getByRole('button', { name: /Students:/ }).click()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return Lin to the waiting room' })).toBeVisible()

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Return Ada to the waiting room' }).click()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeEnabled()

  let pendingRoute: Route | null = null
  await page.route(`**/students/student-1/return-to-waiting-room`, async (route) => {
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

  await adaPage.close()
  await linPage.close()
})

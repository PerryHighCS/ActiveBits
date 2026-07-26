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

test('SyncDeck manager boots a roster student through the rendered panel action', async ({ page }) => {
  const session = await createInstructorSession(page)
  const configured = await page.request.post(`/api/syncdeck/${session.id}/configure`, {
    data: { instructorPasscode: session.instructorPasscode, presentationUrl: 'https://slides.example/deck' },
  })
  expect(configured.ok()).toBeTruthy()
  await acceptStudent(page, session.id, 'student-1', 'Ada')
  await acceptStudent(page, session.id, 'student-2', 'Lin')
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
  await page.evaluate((sessionId) => new Promise<void>((resolve) => {
    const ids = ['student-1', 'student-2']
    const sockets: WebSocket[] = []
    let opened = 0
    for (const studentId of ids) {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/syncdeck?sessionId=${encodeURIComponent(sessionId)}&studentId=${studentId}`)
      sockets.push(ws)
      ws.addEventListener('open', () => { if (++opened === ids.length) resolve() })
    }
    Object.assign(window, { __syncDeckStudentSockets: sockets })
  }), session.id)
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
})

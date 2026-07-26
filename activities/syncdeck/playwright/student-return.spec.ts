import { expect, test } from '@playwright/test'

async function createInstructorSession(page: import('@playwright/test').Page): Promise<{ id: string; instructorPasscode: string }> {
  const response = await page.request.post('/api/syncdeck/create')
  expect(response.ok()).toBeTruthy()
  return await response.json() as { id: string; instructorPasscode: string }
}

async function acceptStudent(page: import('@playwright/test').Page, sessionId: string, participantId: string, displayName: string): Promise<void> {
  const stored = await page.request.post(`/api/session/${sessionId}/entry-participant`, { data: { values: { participantId, displayName } } })
  const { entryParticipantToken } = await stored.json() as { entryParticipantToken: string }
  await page.request.post(`/api/session/${sessionId}/entry-participant/consume`, { data: { token: entryParticipantToken } })
}

test('SyncDeck manager boots a roster student through the rendered panel action', async ({ page }) => {
  const session = await createInstructorSession(page)
  await acceptStudent(page, session.id, 'student-1', 'Ada')
  await acceptStudent(page, session.id, 'student-2', 'Lin')
  await page.goto(`/manage/syncdeck/${session.id}`)
  await expect(page.getByRole('button', { name: 'Students: 0' })).toBeVisible()
  await page.evaluate((sessionId) => new Promise<void>((resolve) => {
    const ids = ['student-1', 'student-2']
    let opened = 0
    for (const studentId of ids) {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/syncdeck?sessionId=${encodeURIComponent(sessionId)}&studentId=${studentId}`)
      ws.addEventListener('open', () => { if (++opened === ids.length) resolve() })
    }
  }), session.id)
  await expect(page.getByRole('button', { name: 'Students: 2' })).toBeVisible()
  await page.getByRole('button', { name: /Students:/ }).click()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return Lin to the waiting room' })).toBeVisible()

  page.on('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Return Ada to the waiting room' }).click()
  await expect(page.getByRole('button', { name: 'Return Ada to the waiting room' })).toBeEnabled()

  await page.unrouteAll()
  await page.route(`**/students/student-1/return-to-waiting-room`, async (route) => route.fulfill({ status: 500, body: '{}' }))
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Return Ada to the waiting room' }).click()
  await expect(page.getByRole('alert')).toContainText('Unable to return this student')
})

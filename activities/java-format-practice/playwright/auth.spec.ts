import { expect, test } from '@playwright/test'

test('Java Format manager and accepted participant recover from httpOnly cookies', async ({ browser }) => {
  const managerPage = await browser.newPage()
  const created = await managerPage.request.post('/api/java-format-practice/create')
  expect(created.ok()).toBe(true)
  const { id: sessionId } = await created.json() as { id: string }

  await managerPage.goto(`/manage/java-format-practice/${encodeURIComponent(sessionId)}`)
  await expect(managerPage.getByRole('heading', { name: 'Format Difficulty Level' })).toBeVisible()

  const stored = await managerPage.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant`, {
    data: { values: { displayName: 'Ada' } },
  })
  const entry = await stored.json() as { entryParticipantToken: string }
  await managerPage.request.post(`/api/session/${encodeURIComponent(sessionId)}/entry-participant/consume`, {
    data: { token: entry.entryParticipantToken },
  })
  const cookieName = `activebits_participant_${Buffer.from(sessionId).toString('base64url')}`
  const cookie = (await managerPage.context().cookies()).find((entryCookie) => entryCookie.name === cookieName)
  expect(cookie).toBeTruthy()

  const studentPage = await browser.newPage()
  await studentPage.goto('/')
  const origin = new URL(studentPage.url())
  await studentPage.context().addCookies([{ name: cookieName, value: cookie!.value, domain: origin.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }])
  await studentPage.addInitScript(({ id }) => {
    window.localStorage.setItem(`session-participant:${id}`, JSON.stringify({ studentId: 'hint-only', studentName: 'Ada' }))
  }, { id: sessionId })
  await studentPage.goto(`/${encodeURIComponent(sessionId)}`)
  await expect(studentPage.getByRole('heading', { name: 'Your Progress' })).toBeVisible()

  await managerPage.close()
  await studentPage.close()
})

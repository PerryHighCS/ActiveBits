import { expect, test } from '@playwright/test'

interface PersistentSessionCreateResponse {
  url: string
}

test('waiting room remembers a student display name in the browser cookie', async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new Error('Playwright baseURL must be configured for waiting-room cookie coverage.')
  }

  const seedContext = await browser.newContext({ baseURL })
  const seedPage = await seedContext.newPage()
  const createResponse = await seedPage.request.post('/api/persistent-session/create', {
    data: {
      activityName: 'java-string-practice',
      teacherCode: 'waiting-room-cookie-test',
    },
  })
  expect(createResponse.ok()).toBe(true)
  const persistentSession = await createResponse.json() as PersistentSessionCreateResponse

  const studentContext = await browser.newContext({ baseURL })
  const studentPage = await studentContext.newPage()
  await studentPage.goto(persistentSession.url)

  const displayName = studentPage.locator('#waiting-room-field-displayName')
  await expect(displayName).toBeVisible()
  await displayName.fill('Ada Lovelace')
  await expect(studentPage.context().cookies()).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: 'activebits_student_display_name',
      value: 'Ada%20Lovelace',
      sameSite: 'Lax',
      path: '/',
    }),
  ]))

  await studentPage.reload()
  await expect(displayName).toHaveValue('Ada Lovelace')

  await studentContext.close()
  await seedContext.close()
})

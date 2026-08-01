import { expect, test } from '@playwright/test'

interface SyncDeckCreateResponse {
  id?: unknown
  instructorPasscode?: unknown
}

test('an instructor manager redirects when its SyncDeck session ends', async ({ page }) => {
  test.skip(
    test.info().project.name !== 'chromium',
    'Non-Chromium test contexts do not retain Set-Cookie responses from fetch in this harness.',
  )
  await page.goto('/')

  const created = await page.evaluate(async () => {
    const response = await fetch('/api/syncdeck/create', {
      method: 'POST',
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(`Unable to create SyncDeck session: ${response.status}`)
    }
    return response.json() as Promise<SyncDeckCreateResponse>
  })

  expect(typeof created.id).toBe('string')
  expect(typeof created.instructorPasscode).toBe('string')
  const sessionId = created.id as string
  const instructorPasscode = created.instructorPasscode as string

  await page.evaluate(async ({ id, passcode }) => {
    const response = await fetch(`/api/syncdeck/${encodeURIComponent(id)}/configure`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presentationUrl: 'https://example.com/syncdeck-instructor-session-ended',
        instructorPasscode: passcode,
      }),
    })
    if (!response.ok) {
      throw new Error(`Unable to configure SyncDeck session: ${response.status}`)
    }
  }, { id: sessionId, passcode: instructorPasscode })

  await page.goto(`/manage/syncdeck/${encodeURIComponent(sessionId)}`)
  await expect(page.getByRole('button', { name: 'Force sync students to current position' })).toBeEnabled()

  await page.evaluate(async (id) => {
    const passcodeResponse = await fetch(`/api/syncdeck/${encodeURIComponent(id)}/instructor-passcode`, {
      credentials: 'include',
    })
    if (!passcodeResponse.ok) {
      throw new Error(`Unable to recover SyncDeck instructor credentials: ${passcodeResponse.status}`)
    }
    const { instructorPasscode } = await passcodeResponse.json() as { instructorPasscode?: unknown }
    if (typeof instructorPasscode !== 'string' || instructorPasscode.length === 0) {
      throw new Error('SyncDeck instructor credential recovery returned an invalid passcode')
    }
    const response = await fetch(`/api/syncdeck/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructorPasscode }),
    })
    if (!response.ok) {
      throw new Error(`Unable to end SyncDeck session: ${response.status}`)
    }
  }, sessionId)

  await expect(page).toHaveURL(/\/session-ended$/)
  await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible()
})

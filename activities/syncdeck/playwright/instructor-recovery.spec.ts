import { expect, test } from '@playwright/test'

interface SyncDeckCreateResponse {
  id?: unknown
  instructorPasscode?: unknown
}

test('a temporary SyncDeck instructor keeps control after reloading the manager window', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit test contexts do not retain Set-Cookie responses from fetch in this harness.')
  await page.goto('/')
  const created = await page.evaluate(async () => {
    const response = await fetch('/api/syncdeck/create', { method: 'POST', credentials: 'include' })
    if (!response.ok) {
      throw new Error(`Unable to create SyncDeck session: ${response.status}`)
    }
    return response.json() as Promise<SyncDeckCreateResponse>
  })
  expect(typeof created.id).toBe('string')
  expect(typeof created.instructorPasscode).toBe('string')

  const sessionId = created.id as string
  const expectedPasscode = created.instructorPasscode as string
  await page.goto(`/manage/syncdeck/${encodeURIComponent(sessionId)}`)
  await page.reload()

  const recoveryCookies = (await context.cookies()).filter(
    (cookie) => cookie.name === `syncdeck_instructor_recovery_${sessionId}`,
  )
  expect(recoveryCookies).toHaveLength(1)
  expect(recoveryCookies[0]).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api/syncdeck',
  })

  const recovery = await page.evaluate(async (id) => {
    const response = await fetch(`/api/syncdeck/${encodeURIComponent(id)}/instructor-passcode`, {
      credentials: 'include',
    })
    return {
      status: response.status,
      payload: await response.json(),
    }
  }, sessionId)

  expect(recovery.status).toBe(200)
  expect(recovery.payload).toEqual({ instructorPasscode: expectedPasscode })
})

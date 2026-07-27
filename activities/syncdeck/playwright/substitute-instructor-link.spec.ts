import { createHmac, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const hmacSecret = process.env.PLAYWRIGHT_LEARN_SYNCDECK_HMAC_SECRET

function createSubstituteInstructorUrl(): string {
  if (!hmacSecret) throw new Error('PLAYWRIGHT_LEARN_SYNCDECK_HMAC_SECRET was not configured for the browser test.')
  const payload = Buffer.from(JSON.stringify({
    expiresAt: Date.now() + 60_000,
    jti: randomUUID(),
    presentationUrl: 'https://slides.example/substitute-instructor-deck',
    provider: 'playwright-learn',
    resourceLinkId: `resource-${randomUUID()}`,
    v: 1,
  }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', hmacSecret)
    .update(`LEARN_SYNCDECK_SUBSTITUTE_LINK\n${payload}`, 'utf8')
    .digest('hex')
  return `/api/syncdeck/learn/substitute?payload=${encodeURIComponent(payload)}&sig=${signature}`
}

test('a signed substitute instructor link opens a recoverable SyncDeck manager without retaining link credentials', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'chromium', 'WebKit test contexts do not retain Set-Cookie responses from fetch in this harness.')

  await page.goto(createSubstituteInstructorUrl())
  await expect(page).toHaveURL(/\/manage\/syncdeck\/[a-z0-9-]+$/)
  expect(page.url()).not.toContain('payload=')
  expect(page.url()).not.toContain('sig=')

  const sessionId = new URL(page.url()).pathname.split('/').at(-1)
  expect(sessionId).toBeTruthy()
  const recoveryCookies = (await context.cookies()).filter(
    (cookie) => cookie.name === 'syncdeck_instructor_recoveries',
  )
  expect(recoveryCookies).toHaveLength(1)
  expect(recoveryCookies[0]).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api/syncdeck',
  })

  const recovery = await page.evaluate(async (id) => {
    const response = await fetch(`/api/syncdeck/${encodeURIComponent(id ?? '')}/instructor-passcode`, {
      credentials: 'include',
    })
    return response.status
  }, sessionId)
  expect(recovery).toBe(200)
})

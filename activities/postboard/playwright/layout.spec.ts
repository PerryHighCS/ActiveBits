import { expect, type Page, test } from '@playwright/test'

interface PostboardCreateResponse {
  id: string
  instructorPasscode: string
}

async function createPostboardSession(page: Page): Promise<PostboardCreateResponse> {
  const response = await page.request.post('/api/postboard/create')
  expect(response.ok()).toBe(true)
  return await response.json() as PostboardCreateResponse
}

async function openPostboardManager(page: Page, session: PostboardCreateResponse): Promise<void> {
  await page.addInitScript(({ instructorPasscode }) => {
    window.history.replaceState(
      {
        usr: { createSessionPayload: { instructorPasscode } },
        key: 'postboard-layout-playwright',
        idx: 0,
      },
      '',
      window.location.href,
    )
  }, { instructorPasscode: session.instructorPasscode })
  await page.goto(`/manage/postboard/${encodeURIComponent(session.id)}`)
  await expect(page.getByRole('heading', { name: /Board Posts/ })).toBeVisible()
}

test('empty board keeps the prompt bar and board panel aligned with the top of the moderation sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const session = await createPostboardSession(page)
  await openPostboardManager(page, session)

  // With no posts, the moderation queue + compose sidebar is taller than the
  // prompt bar/board panel column. They must still start at the same top
  // edge instead of the shorter column being pushed down to bottom-align
  // with the taller sidebar (regression: align-items: flex-end on the row).
  const promptBarBox = await page.locator('.postboard-prompt-bar').boundingBox()
  const sidebarBox = await page.locator('.postboard-sticky-side').boundingBox()
  expect(promptBarBox).not.toBeNull()
  expect(sidebarBox).not.toBeNull()
  expect(Math.abs((promptBarBox?.y ?? 0) - (sidebarBox?.y ?? 0))).toBeLessThanOrEqual(1)
})

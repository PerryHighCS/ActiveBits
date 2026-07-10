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

async function createPostboardPost(page: Page, session: PostboardCreateResponse, text: string): Promise<void> {
  const response = await page.request.post(`/api/postboard/${encodeURIComponent(session.id)}/posts`, {
    data: { text, instructorPasscode: session.instructorPasscode },
  })
  expect(response.ok()).toBe(true)
}

async function openPostboardManager(page: Page, session: PostboardCreateResponse): Promise<void> {
  await page.addInitScript(({ instructorPasscode }) => {
    window.history.replaceState(
      {
        usr: { createSessionPayload: { instructorPasscode } },
        key: 'postboard-playwright',
        idx: 0,
      },
      '',
      window.location.href,
    )
  }, { instructorPasscode: session.instructorPasscode })
  await page.goto(`/manage/postboard/${encodeURIComponent(session.id)}`)
  await expect(page.getByRole('heading', { name: /All Posts/ })).toBeVisible()
}

function boardCardTexts(page: Page): Promise<string[]> {
  return page.locator('.postboard-board .postboard-card').evaluateAll(
    (cards) => cards.map((card) => card.querySelector('p:not(.postboard-meta)')?.textContent ?? ''),
  )
}

test('instructor can drag and drop board cards to reorder them', async ({ page }) => {
  const session = await createPostboardSession(page)
  await createPostboardPost(page, session, 'Note 1')
  await createPostboardPost(page, session, 'Note 2')
  await createPostboardPost(page, session, 'Note 3')
  await openPostboardManager(page, session)

  const cards = page.locator('.postboard-board .postboard-card')
  await expect(cards).toHaveCount(3)
  await expect.poll(() => boardCardTexts(page)).toEqual(['Note 1', 'Note 2', 'Note 3'])

  const source = cards.filter({ hasText: 'Note 1' })
  const target = cards.filter({ hasText: 'Note 3' })

  const reorderResponse = page.waitForResponse((response) =>
    response.url().includes('/reorder') && response.request().method() === 'POST',
  )
  await source.dragTo(target)
  await reorderResponse

  await expect.poll(() => boardCardTexts(page)).toEqual(['Note 2', 'Note 3', 'Note 1'])

  await page.reload()
  await expect(cards).toHaveCount(3)
  await expect.poll(() => boardCardTexts(page)).toEqual(['Note 2', 'Note 3', 'Note 1'])
})

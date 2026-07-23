import { expect, test } from '@playwright/test'

test('Learn SyncDeck waiting room polls status and enters an active student session', async ({ page }) => {
  await page.route('/api/integrations/learn/v1/activities/syncdeck/wait/status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ state: 'active', studentLaunchUrl: '/learn-syncdeck-active-session' }),
    })
  })

  await page.goto('/integrations/learn/syncdeck/wait')
  await expect(page).toHaveURL(/\/learn-syncdeck-active-session$/)
})

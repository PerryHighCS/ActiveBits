import { expect, test } from '@playwright/test'

test.describe('SyncDeck report preview overlay', () => {
  test('report preview dialog escapes the sticky header stacking context and stays closable', async ({ page }) => {
    // Reach the manager the way an instructor actually does: create a session
    // from the dashboard so the instructor passcode arrives via same-tab
    // router state instead of browser storage.
    await page.goto('/manage')
    const syncDeckCard = page.locator('div.rounded-lg', { has: page.getByRole('heading', { name: 'SyncDeck', exact: true }) })
    await syncDeckCard.getByRole('button', { name: 'Start Session Now' }).click()
    await page.waitForURL(/\/manage\/syncdeck\//)

    const previewButton = page.getByRole('button', { name: 'Preview Report' })
    await expect(previewButton).toBeEnabled()
    await previewButton.click()

    const dialog = page.locator('#syncdeck-report-preview-dialog')
    await expect(dialog).toBeVisible()

    // Regression guard for the bug where this dialog was rendered inside the
    // sticky header's stacking context, trapping it behind embedded activity
    // content that sits in a later, higher DOM-order stacking context. The
    // dialog's overlay wrapper must be portalled directly under document.body.
    const overlayParentIsBody = await page.evaluate(() => {
      const dialogElement = document.getElementById('syncdeck-report-preview-dialog')
      const overlay = dialogElement?.parentElement ?? null
      return overlay?.parentElement === document.body
    })
    expect(overlayParentIsBody).toBe(true)

    const closeButton = dialog.getByRole('button', { name: 'Close' }).first()
    await expect(closeButton).toBeVisible()
    await closeButton.click()
    await expect(dialog).toHaveCount(0)
    await expect(previewButton).toBeFocused()
  })
})

import { expect, test } from '@playwright/test'

test.describe('SyncDeck report preview overlay', () => {
  test('report preview dialog escapes the sticky header stacking context and stays closable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => undefined },
      })
    })

    // Reach the manager the way an instructor actually does: create a session
    // from the dashboard so the instructor passcode arrives via same-tab
    // router state instead of browser storage.
    await page.goto('/manage')
    const syncDeckCard = page.locator('div.rounded-lg', { has: page.getByRole('heading', { name: 'SyncDeck', exact: true }) })
    await syncDeckCard.getByRole('button', { name: 'Start Session Now' }).click()
    await page.waitForURL(/\/manage\/syncdeck\//)

    const previewButton = page.getByRole('button', { name: 'Session Report' })
    await expect(previewButton).toBeEnabled()
    await expect(previewButton).toBeVisible()
    const copyJoinCodeButton = page.getByRole('button', { name: 'Copy join code' })
    await expect(copyJoinCodeButton).toHaveText(/^[a-z0-9-]+$/i)
    const copyJoinUrlButton = page.getByRole('button', { name: 'Copy join URL' })
    await expect(copyJoinUrlButton).toHaveText('🔗')
    await expect(copyJoinUrlButton).toHaveAttribute('title', 'Copy join URL')
    const joinCode = page.getByText('Join Code:', { exact: true })
    await expect(joinCode).toBeVisible()
    const joinCodeHandle = await joinCode.elementHandle()
    expect(joinCodeHandle).not.toBeNull()
    if (!joinCodeHandle) {
      throw new Error('Expected the visible Join Code control to have a DOM element.')
    }
    const reportPrecedesJoinCode = await previewButton.evaluate(
      (reportButton, joinCodeLabel) => Boolean(
        reportButton.compareDocumentPosition(joinCodeLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      joinCodeHandle,
    )
    await joinCodeHandle.dispose()
    expect(reportPrecedesJoinCode).toBe(true)
    await copyJoinCodeButton.click()
    await expect(page.getByRole('button', { name: 'Join code copied' })).toHaveText('✓ Copied!')
    await copyJoinUrlButton.click()
    await expect(page.getByRole('button', { name: 'Join URL copied' })).toHaveText('✓')
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

    await expect(dialog.getByRole('heading', { name: 'Session Summary' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Download Session Report' })).toBeVisible()
    const closeButton = dialog.getByRole('button', { name: 'Close Session Summary' })
    await expect(closeButton).toBeVisible()
    await closeButton.click()
    await expect(dialog).toHaveCount(0)
    await expect(previewButton).toBeFocused()
  })
})

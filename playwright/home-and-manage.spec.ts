import { expect, test } from '@playwright/test'

const HOME_CARD_HEADINGS = [
  'Algorithm Practice',
  'Java Format Practice',
  'Java String Practice',
  'Python List Practice',
  'Traveling Salesman',
]

const HOME_UTILITY_HEADINGS = [
  'Gallery Walk Review',
]

const MANAGE_ACTIVITY_HEADINGS = [
  'Algorithm Demonstrations',
  'Gallery Walk',
  'Java Format Practice',
  'Java String Practice',
  'Python List Practice',
  'Raffle',
  'Resonance',
  'SyncDeck',
  'Traveling Salesman',
  'Video Sync',
  'WWW Simulation',
]

test('home route shows the expected standalone and utility activity cards', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  await expect(page.getByLabel('Join Code:')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join Session' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Standalone Activities' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Utility Tools' })).toBeVisible()

  for (const heading of HOME_CARD_HEADINGS) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  for (const heading of HOME_UTILITY_HEADINGS) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
})

test('manage route shows the expected activity cards and dashboard actions', async ({ page }) => {
  await page.goto('/manage', { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { name: 'Activity Dashboard' })).toBeVisible()
  await expect(page.getByText('Choose an activity to start a new session')).toBeVisible()

  for (const heading of MANAGE_ACTIVITY_HEADINGS) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  await expect(page.getByRole('button', { name: 'Start Session Now' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Permanent Link' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resonance Tools' })).toBeVisible()
})

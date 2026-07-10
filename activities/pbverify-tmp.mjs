import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (err) => console.log('[page error]', err.message))

await page.goto(`${BASE}/manage`, { waitUntil: 'networkidle' })
const cardHeading = page.locator('text=Postboard').first()
const card = cardHeading.locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
await card.getByText('Start Session Now').click()
await page.waitForURL(/\/manage\/postboard\//, { timeout: 15000 })
await page.waitForTimeout(500)
await page.locator('#postboard-setup-form textarea').fill('Up arrow sanity test')
await page.getByRole('button', { name: 'Save prompt' }).click()
await page.waitForTimeout(500)
await page.locator('.postboard-header-toggle').click()
await page.waitForTimeout(500)

for (let i = 1; i <= 3; i++) {
  await page.locator('.postboard-compose-panel textarea').fill(`Note ${i}`)
  await page.locator('.postboard-compose-panel').getByRole('button', { name: /Post note/ }).click()
  await page.waitForTimeout(150)
}
await page.waitForTimeout(500)

const getNoteOrder = async () => page.locator('.postboard-board .postboard-card').evaluateAll(
  (cards) => cards.map((c) => c.querySelector('p:not(.postboard-meta)')?.textContent)
)

const before = await getNoteOrder()
console.log('before:', before)
await page.locator('.postboard-board .postboard-card').nth(1).getByRole('button', { name: 'Move note up' }).click()
await page.waitForTimeout(500)
const after = await getNoteOrder()
console.log('after:', after)
console.log('order changed as expected:', JSON.stringify(before) !== JSON.stringify(after))

await browser.close()

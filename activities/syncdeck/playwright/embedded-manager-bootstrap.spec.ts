import { expect, test, type Page } from '@playwright/test'

interface SyncDeckCreateResponse {
  id?: unknown
  instructorPasscode?: unknown
}

interface EmbeddedStartResponse {
  childSessionId?: unknown
  managerEntryToken?: unknown
}

async function startEmbeddedManager(page: Page, activityId: string, activityOptions: Record<string, unknown>): Promise<{
  childSessionId: string
  managerEntryToken: string
}> {
  const createResponse = await page.request.post('/api/syncdeck/create')
  expect(createResponse.ok()).toBeTruthy()
  const created = await createResponse.json() as SyncDeckCreateResponse
  expect(typeof created.id).toBe('string')
  expect(typeof created.instructorPasscode).toBe('string')

  const parentSessionId = created.id as string
  const instructorPasscode = created.instructorPasscode as string
  const startResponse = await page.request.post(
    `/api/syncdeck/${encodeURIComponent(parentSessionId)}/embedded-activity/start`,
    {
      data: {
        instructorPasscode,
        activityId,
        instanceKey: `${activityId}:0:0`,
        location: { h: 0, v: 0 },
        activityOptions,
      },
    },
  )
  expect(startResponse.ok()).toBeTruthy()
  const started = await startResponse.json() as EmbeddedStartResponse
  expect(typeof started.childSessionId).toBe('string')
  expect(typeof started.managerEntryToken).toBe('string')

  return {
    childSessionId: started.childSessionId as string,
    managerEntryToken: started.managerEntryToken as string,
  }
}

async function openEmbeddedManagerIframe(
  page: Page,
  activityId: string,
  bootstrap: { childSessionId: string; managerEntryToken: string },
) {
  // setContent retains the current document URL, so establish the app origin
  // before assigning a relative iframe source.
  await page.goto('/')
  await page.setContent('<iframe title="Embedded manager"></iframe>')
  const source = `/manage/${encodeURIComponent(activityId)}/${encodeURIComponent(bootstrap.childSessionId)}?embeddedManagerToken=${encodeURIComponent(bootstrap.managerEntryToken)}`
  await page.getByTitle('Embedded manager').evaluate((iframe, nextSource) => {
    iframe.setAttribute('src', nextSource)
  }, source)
  return page.frameLocator('iframe[title="Embedded manager"]')
}

test.describe('SyncDeck embedded instructor manager bootstrap', () => {
  test('VideoSync exchanges its token in an iframe and skips manual configuration', async ({ page }) => {
    const bootstrap = await startEmbeddedManager(page, 'video-sync', {
      sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
    })
    const manager = await openEmbeddedManagerIframe(page, 'video-sync', bootstrap)

    await expect(manager.getByText('Video: mCq8-xTH7jA')).toBeVisible()
    await expect(manager.getByText('Instructor credentials missing. Open this session from the dashboard or authenticated permalink.')).toHaveCount(0)
    await expect(manager.getByRole('button', { name: 'Start instructor view' })).toHaveCount(0)
  })

  test('Resonance exchanges its token in an iframe and loads its instructor view', async ({ page }) => {
    const bootstrap = await startEmbeddedManager(page, 'resonance', {
      questions: [{
        id: 'bootstrap-question',
        type: 'free-response',
        text: 'Embedded instructor bootstrap question',
        order: 0,
        responseTimeLimitMs: 30_000,
      }],
    })
    const manager = await openEmbeddedManagerIframe(page, 'resonance', bootstrap)

    await expect(manager.getByRole('button', { name: 'Select Embedded instructor bootstrap question' })).toBeVisible()
    await expect(manager.getByText('Instructor passcode not found. Try re-entering from the session creation link.')).toHaveCount(0)
  })

  test('MobCode exchanges its token in an iframe and enables instructor file controls', async ({ page }) => {
    const bootstrap = await startEmbeddedManager(page, 'mobcode', {
      files: { 'src/Main.java': 'class Main {}' },
      activeFile: 'src/Main.java',
    })
    const manager = await openEmbeddedManagerIframe(page, 'mobcode', bootstrap)

    await expect(manager.getByRole('button', { name: 'Files' })).toBeVisible()
  })

  test('Postboard exchanges its token in an iframe and loads the seeded instructor prompt', async ({ page }) => {
    const bootstrap = await startEmbeddedManager(page, 'postboard', {
      prompt: 'What should we add to the board?',
      autoApprove: 'true',
    })
    const manager = await openEmbeddedManagerIframe(page, 'postboard', bootstrap)

    await expect(manager.getByRole('switch', { name: 'Auto-approve is on. Turn off to require moderation.' })).toBeVisible()
    await expect(manager.getByText('What should we add to the board?')).toHaveCount(1)
    await expect(manager.getByText('Instructor credentials were not found for this tab. Start Postboard from the dashboard again to manage this session.')).toHaveCount(0)
  })
})

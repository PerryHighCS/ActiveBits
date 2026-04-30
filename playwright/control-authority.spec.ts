import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const SYNCDECK_PASSCODE_KEY_PREFIX = 'syncdeck_instructor_'

async function createConfiguredSyncDeckSession(request: APIRequestContext): Promise<{
  sessionId: string
  instructorPasscode: string
}> {
  const createResponse = await request.post('/api/syncdeck/create')
  expect(createResponse.ok()).toBe(true)
  const createPayload = await createResponse.json() as {
    id?: unknown
    instructorPasscode?: unknown
  }
  expect(typeof createPayload.id).toBe('string')
  expect(typeof createPayload.instructorPasscode).toBe('string')

  const sessionId = createPayload.id as string
  const instructorPasscode = createPayload.instructorPasscode as string
  const configureResponse = await request.post(`/api/syncdeck/${encodeURIComponent(sessionId)}/configure`, {
    data: {
      presentationUrl: 'https://example.com/syncdeck-control-authority-e2e',
      instructorPasscode,
      instructorInstanceId: 'browser-owner:tab-owner',
      standaloneMode: false,
    },
  })
  expect(configureResponse.ok()).toBe(true)

  return { sessionId, instructorPasscode }
}

async function openSyncDeckInstructorPage(params: {
  browser: Browser
  baseURL: string | undefined
  sessionId: string
  instructorPasscode: string
  browserId: string
  tabId: string
}): Promise<Page> {
  const context = await params.browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(
    ({ sessionId, instructorPasscode, passcodeKeyPrefix, browserId, tabId }) => {
      window.localStorage.setItem('activebits:instructor-control:browser-id', browserId)
      window.sessionStorage.setItem('activebits:instructor-control:tab-id', tabId)
      window.sessionStorage.setItem(`${passcodeKeyPrefix}${sessionId}`, instructorPasscode)
    },
    {
      sessionId: params.sessionId,
      instructorPasscode: params.instructorPasscode,
      passcodeKeyPrefix: SYNCDECK_PASSCODE_KEY_PREFIX,
      browserId: params.browserId,
      tabId: params.tabId,
    },
  )

  await page.goto(`${params.baseURL ?? ''}/manage/syncdeck/${encodeURIComponent(params.sessionId)}`, {
    waitUntil: 'networkidle',
  })
  return page
}

test('SyncDeck manager control authority disables non-owner controls and flips after takeover', async ({
  baseURL,
  browser,
  request,
}) => {
  const { sessionId, instructorPasscode } = await createConfiguredSyncDeckSession(request)
  const pages: Page[] = []

  try {
    const ownerPage = await openSyncDeckInstructorPage({
      browser,
      baseURL,
      sessionId,
      instructorPasscode,
      browserId: 'browser-owner',
      tabId: 'tab-owner',
    })
    pages.push(ownerPage)

    const peerPage = await openSyncDeckInstructorPage({
      browser,
      baseURL,
      sessionId,
      instructorPasscode,
      browserId: 'browser-peer',
      tabId: 'tab-peer',
    })
    pages.push(peerPage)

    await expect(ownerPage.getByText('You have control')).toBeVisible()
    await expect(peerPage.getByText('Another instructor has control')).toBeVisible()
    await expect(peerPage.getByRole('button', { name: 'Force sync students to current position' })).toBeDisabled()

    await peerPage.getByRole('button', { name: 'Take Control' }).click()

    await expect(peerPage.getByText('You have control')).toBeVisible()
    await expect(ownerPage.getByText('Another instructor has control')).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Force sync students to current position' })).toBeDisabled()
    await expect(peerPage.getByRole('button', { name: 'Force sync students to current position' })).toBeEnabled()
  } finally {
    await Promise.all(pages.map((page) => page.context().close()))
    await request.delete(`/api/syncdeck/${encodeURIComponent(sessionId)}`, {
      data: {
        instructorPasscode,
      },
    })
  }
})

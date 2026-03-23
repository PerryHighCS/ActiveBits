import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

interface SyncDeckSessionBootstrap {
  sessionId: string
  instructorPasscode: string
}

const OVERLAY_NAV_TEST_PATH = '/__playwright/syncdeck-overlay-nav-test.html'

function buildFakePresentationHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SyncDeck Overlay Nav Test</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        font-family: sans-serif;
        background: #f4f4f5;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      .card {
        width: min(90vw, 800px);
        min-height: 60vh;
        padding: 24px;
        border-radius: 20px;
        background: white;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
      }
      #status {
        font-size: 20px;
        font-weight: 700;
      }
      #hint {
        margin-top: 12px;
        color: #52525b;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <div id="status">booting</div>
        <div id="hint">Any click inside this iframe advances the local fragment counter.</div>
      </div>
    </main>
    <script>
      (() => {
        const statusEl = document.getElementById('status')
        let indices = { h: 3, v: 0, f: 0 }
        let role = 'standalone'
        const statusHistory = []
        window.__syncdeckStatusHistory = statusHistory

        function envelope(action, payload) {
          return {
            type: 'reveal-sync',
            version: '2.0.0',
            source: 'reveal-iframe-sync',
            role,
            action,
            payload,
          }
        }

        function render() {
          const statusText = \`slide \${indices.h}:\${indices.v} fragment \${indices.f}\`
          statusEl.textContent = statusText
          statusHistory.push(statusText)
        }

        function emitState() {
          render()
          window.parent.postMessage(
            envelope('state', {
              indices,
              navigation: {
                current: indices,
                canGoBack: indices.h > 0,
                canGoForward: true,
                canGoUp: false,
                canGoDown: false,
              },
            }),
            window.location.origin,
          )
        }

        window.addEventListener('message', (event) => {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
          if (!data || typeof data !== 'object' || data.type !== 'reveal-sync') {
            return
          }

          const commandEnvelope = data.payload && typeof data.payload === 'object' ? data.payload : null
          if (data.action !== 'command' || !commandEnvelope) {
            return
          }

          if (commandEnvelope.name === 'setRole') {
            const rolePayload = commandEnvelope.payload && typeof commandEnvelope.payload === 'object'
              ? commandEnvelope.payload
              : null
            const nextRole = rolePayload ? rolePayload.role : null
            if (typeof nextRole === 'string') {
              role = nextRole
            }
            return
          }

          if (commandEnvelope.name === 'setState') {
            const commandPayload = commandEnvelope.payload && typeof commandEnvelope.payload === 'object'
              ? commandEnvelope.payload
              : null
            const state = commandPayload && commandPayload.state && typeof commandPayload.state === 'object'
              ? commandPayload.state
              : null
            if (state && typeof state === 'object') {
              indices = {
                h: Number.isFinite(state.indexh) ? Number(state.indexh) : indices.h,
                v: Number.isFinite(state.indexv) ? Number(state.indexv) : indices.v,
                f: Number.isFinite(state.indexf) ? Number(state.indexf) : 0,
              }
              emitState()
            }
          }
        })

        window.addEventListener('click', () => {
          indices = { ...indices, f: indices.f + 1 }
          emitState()
        })

        render()
        window.parent.postMessage(envelope('ready', {}), window.location.origin)
        emitState()
      })()
    </script>
  </body>
</html>`
}

async function createSyncDeckSession(request: APIRequestContext, baseURL: string): Promise<SyncDeckSessionBootstrap> {
  const createResponse = await request.post('/api/syncdeck/create')
  expect(createResponse.ok()).toBeTruthy()

  const createBody = await createResponse.json() as {
    id: string
    instructorPasscode: string
  }

  const configureResponse = await request.post(`/api/syncdeck/${createBody.id}/configure`, {
    data: {
      instructorPasscode: createBody.instructorPasscode,
      presentationUrl: `${baseURL}${OVERLAY_NAV_TEST_PATH}`,
    },
  })
  expect(configureResponse.ok()).toBeTruthy()

  const startResponse = await request.post(`/api/syncdeck/${createBody.id}/embedded-activity/start`, {
    data: {
      instructorPasscode: createBody.instructorPasscode,
      activityId: 'raffle',
      instanceKey: 'raffle:3:0',
    },
  })
  expect(startResponse.ok()).toBeTruthy()

  return {
    sessionId: createBody.id,
    instructorPasscode: createBody.instructorPasscode,
  }
}

async function seedSyncDeckManagerPasscode(page: Page, sessionId: string, instructorPasscode: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value)
    },
    [`syncdeck_instructor_${sessionId}`, instructorPasscode] as const,
  )
}

test('syncdeck overlay nav clicks do not leak into the newly selected slide fragment', async ({ page, request, baseURL }) => {
  expect(baseURL).toBeTruthy()

  await page.route(`**${OVERLAY_NAV_TEST_PATH}`, async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: buildFakePresentationHtml(),
    })
  })

  const { sessionId, instructorPasscode } = await createSyncDeckSession(request, baseURL!)
  await seedSyncDeckManagerPasscode(page, sessionId, instructorPasscode)

  await page.goto(`/manage/syncdeck/${sessionId}`, { waitUntil: 'networkidle' })
  await expect(page.getByText('Embedded Manager: raffle')).toBeVisible()

  const presentationFrameHandle = await page.locator('iframe[title="SyncDeck Presentation"]').elementHandle()
  expect(presentationFrameHandle).not.toBeNull()
  const presentationFrame = await presentationFrameHandle!.contentFrame()
  expect(presentationFrame).not.toBeNull()

  const status = presentationFrame!.locator('#status')
  await expect(status).toHaveText('slide 3:0 fragment 0')

  const moveRightButton = page.getByRole('button', { name: 'Move right', exact: true })
  await expect(moveRightButton).toBeVisible()
  await expect(moveRightButton).toBeEnabled()

  await moveRightButton.click({ force: true })
  await expect.poll(async () => {
    return await presentationFrame!.evaluate(() => {
      return (window as typeof window & { __syncdeckStatusHistory?: string[] }).__syncdeckStatusHistory ?? []
    })
  }).toContain('slide 4:0 fragment 0')

  const statusHistoryAfterOverlayClick = await presentationFrame!.evaluate(() => {
    return (window as typeof window & { __syncdeckStatusHistory?: string[] }).__syncdeckStatusHistory ?? []
  })
  expect(statusHistoryAfterOverlayClick).not.toContain('slide 4:0 fragment 1')
})

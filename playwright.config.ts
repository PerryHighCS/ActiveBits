import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3100'
const baseUrl = new URL(baseURL)
const isCi = Boolean(process.env.CI)
const serverHost = baseUrl.hostname
const serverPort =
  baseUrl.port || (baseUrl.protocol === 'https:' ? '443' : '80')
const persistentSessionSecret =
  process.env.PLAYWRIGHT_PERSISTENT_SESSION_SECRET ??
  randomBytes(32).toString('hex')
const shouldReuseClientBuild =
  isCi || process.env.PLAYWRIGHT_REUSE_CLIENT_DIST === '1'
const webServerCommand = shouldReuseClientBuild
  ? "sh -c 'if [ -d client/dist ]; then echo \"Reusing existing client build for Playwright\"; else npm run build --workspace client; fi && npm run start --prefix server'"
  : "sh -c 'npm run build --workspace client && npm run start --prefix server'"

export default defineConfig({
  testDir: './playwright',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: isCi ? 2 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: webServerCommand,
    env: {
      HOST: serverHost,
      NODE_ENV: 'production',
      PORT: serverPort,
      PERSISTENT_SESSION_SECRET: persistentSessionSecret,
    },
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        browserName: 'webkit',
      },
    },
  ],
})

import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3100'
const baseUrl = new URL(baseURL)
const serverHost = baseUrl.hostname
const serverPort =
  baseUrl.port || (baseUrl.protocol === 'https:' ? '443' : '80')
const persistentSessionSecret =
  process.env.PLAYWRIGHT_PERSISTENT_SESSION_SECRET ??
  randomBytes(32).toString('hex')

export default defineConfig({
  testDir: './playwright',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build --workspace client && npm run start --prefix server',
    env: {
      HOST: serverHost,
      NODE_ENV: 'production',
      PORT: serverPort,
      PERSISTENT_SESSION_SECRET: persistentSessionSecret,
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
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

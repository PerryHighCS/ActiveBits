import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import activityConfigSchema from '../../../types/activityConfigSchema.js'

interface ActivityConfigModule {
  default?: {
    isDev?: boolean
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const EXPECTED_ACTIVITIES = [
  'algorithm-demo',
  'syncdeck',
  'video-sync',
  'java-string-practice',
  'java-format-practice',
  'python-list-practice',
  'raffle',
  'gallery-walk',
  'traveling-salesman',
  'www-sim',
]

const CONFIG_FILE_CANDIDATES = ['activity.config.ts', 'activity.config.js']
const CLIENT_ENTRY_CANDIDATES = ['index.tsx', 'index.ts', 'index.jsx', 'index.js']

function firstExistingPath(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) || null
}

function resolveActivityConfigPath(activityPath: string): string | null {
  return firstExistingPath(CONFIG_FILE_CANDIDATES.map((filename) => join(activityPath, filename)))
}

function resolveActivityClientEntryPath(clientPath: string): string | null {
  return firstExistingPath(CLIENT_ENTRY_CANDIDATES.map((filename) => join(clientPath, filename)))
}

async function loadActivityConfig(configPath: string): Promise<ActivityConfigModule['default']> {
  const module = (await import(pathToFileURL(configPath).href)) as ActivityConfigModule
  return module.default
}

const { parseActivityConfig } = activityConfigSchema

void test('all expected activities exist with required files', () => {
  const activitiesDir = join(__dirname, '../../../activities')

  for (const activityId of EXPECTED_ACTIVITIES) {
    const activityPath = join(activitiesDir, activityId)
    const configPath = resolveActivityConfigPath(activityPath)
    const clientDir = join(activityPath, 'client')
    const clientEntryPath = resolveActivityClientEntryPath(clientDir)

    assert.ok(
      existsSync(activityPath) && statSync(activityPath).isDirectory(),
      `Activity directory exists: ${activityId}`,
    )

    assert.ok(Boolean(configPath), `Activity config exists: ${activityId}/activity.config.{js,ts}`)

    assert.ok(
      existsSync(clientDir) && statSync(clientDir).isDirectory(),
      `Client directory exists: ${activityId}/client`,
    )

    assert.ok(
      Boolean(clientEntryPath),
      `Client entry point exists: ${activityId}/client/index.{js,jsx,ts,tsx}`,
    )
  }
})

void test('no unexpected activities in activities directory', async () => {
  const activitiesDir = join(__dirname, '../../../activities')
  const entries = readdirSync(activitiesDir)

  const activityDirs = entries.filter((entry) => {
    const entryPath = join(activitiesDir, entry)
    return statSync(entryPath).isDirectory() && entry !== 'node_modules'
  })

  const unexpectedActivities: string[] = []
  for (const dir of activityDirs) {
    if (EXPECTED_ACTIVITIES.includes(dir)) continue

    const configPath = resolveActivityConfigPath(join(activitiesDir, dir))
    if (configPath) {
      try {
        const config = await loadActivityConfig(configPath)
        if (!config?.isDev) {
          unexpectedActivities.push(dir)
        }
      } catch (error) {
        console.error(`Failed to load config for activity "${dir}":`, error)
        unexpectedActivities.push(dir)
      }
    } else {
      unexpectedActivities.push(dir)
    }
  }

  assert.deepEqual(
    unexpectedActivities,
    [],
    `Found unexpected non-dev activities: ${unexpectedActivities.join(', ')}`,
  )
})

void test('activity count matches expected count', async () => {
  const activitiesDir = join(__dirname, '../../../activities')
  const entries = readdirSync(activitiesDir)

  const activityDirs = entries.filter((entry) => {
    const entryPath = join(activitiesDir, entry)
    return statSync(entryPath).isDirectory() && entry !== 'node_modules' && Boolean(resolveActivityConfigPath(entryPath))
  })

  let nonDevActivityCount = 0
  for (const dir of activityDirs) {
    const configPath = resolveActivityConfigPath(join(activitiesDir, dir))
    if (!configPath) continue

    try {
      const config = await loadActivityConfig(configPath)
      if (!config?.isDev) {
        nonDevActivityCount += 1
      }
    } catch (error) {
      console.error(`Failed to load config for activity "${dir}":`, error)
      nonDevActivityCount += 1
    }
  }

  assert.equal(
    nonDevActivityCount,
    EXPECTED_ACTIVITIES.length,
    `Expected ${EXPECTED_ACTIVITIES.length} non-dev activities, found ${nonDevActivityCount}`,
  )
})

void test('client registry-style config parsing skips invalid config modules with warning', () => {
  const originalWarn = console.warn
  const warnings: string[] = []

  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  }

  try {
    const configModules = {
      '@activities/good/activity.config.ts': {
        default: {
          id: 'good',
          name: 'Good',
          description: 'valid config',
          color: 'blue',
          soloMode: true,
        },
      },
      '@activities/bad/activity.config.ts': {
        default: {
          id: 'bad',
          name: 'Bad',
          description: 'invalid config',
          color: 'red',
          soloMode: false,
          deepLinkGenerator: {
            endpoint: '/api/bad',
            mode: 'wrong-mode',
          },
        },
      },
    } satisfies Record<string, { default?: unknown }>

    const acceptedIds: string[] = []

    for (const [modulePath, moduleExports] of Object.entries(configModules)) {
      try {
        const cfg = parseActivityConfig(moduleExports.default, modulePath)
        acceptedIds.push(cfg.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`Invalid activity config at "${modulePath}", skipping: ${message}`)
      }
    }

    assert.deepEqual(acceptedIds, ['good'])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /Invalid activity config at "@activities\/bad\/activity\.config\.ts", skipping:/)
    assert.match(warnings[0] ?? '', /deepLinkGenerator/)
    assert.match(warnings[0] ?? '', /mode/)
  } finally {
    console.warn = originalWarn
  }
})

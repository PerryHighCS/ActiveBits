import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMissingDiscoveredConfigError } from './activityRegistryMissingConfigError.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Counter for cache-busting module imports to avoid race conditions
let testImportCounter = 0

/**
 * Expected activities in the system (excluding dev-only activities)
 * Update this list when adding or removing production activities
 * Dev activities (with isDev: true) are automatically excluded from these tests
 */
const EXPECTED_ACTIVITIES = [
  'algorithm-demo',
  'syncdeck',
  'java-string-practice',
  'java-format-practice',
  'python-list-practice',
  'raffle',
  'gallery-walk',
  'traveling-salesman',
  'www-sim',
]

const CONFIG_FILE_CANDIDATES = ['activity.config.ts', 'activity.config.js']
const SERVER_ENTRY_CANDIDATES = ['routes.ts', 'routes.js']

interface ActivityConfigLike extends Record<string, unknown> {
  id?: string
  name?: string
  description?: string
  color?: string
  serverEntry?: string
  soloMode?: boolean
  isDev?: boolean
  soloModeMeta?: {
    title?: string
    description?: string
    buttonText?: string
  } | null
}

interface ActivityRegistryModule {
  initializeActivityRegistry: () => Promise<void>
  getAllowedActivities: () => string[]
  registerActivityRoutes: (app: unknown, sessions: unknown, ws: unknown) => Promise<void>
}

function firstExistingPath(paths: readonly string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null
}

function resolveActivityConfigPath(activityPath: string): string | null {
  return firstExistingPath(CONFIG_FILE_CANDIDATES.map((filename) => join(activityPath, filename)))
}

function resolveServerEntryPath(serverPath: string): string | null {
  return firstExistingPath(SERVER_ENTRY_CANDIDATES.map((filename) => join(serverPath, filename)))
}

async function importActivityConfig(configPath: string): Promise<ActivityConfigLike> {
  const mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown }
  const config = mod.default
  if (config !== null && config !== undefined && typeof config === 'object') {
    return config as ActivityConfigLike
  }
  return {}
}

async function importRegistryModule(): Promise<ActivityRegistryModule> {
  const moduleUrl = pathToFileURL(join(__dirname, 'activityRegistry.js')).href
  return import(`${moduleUrl}?t=${Date.now()}-${testImportCounter++}`) as Promise<ActivityRegistryModule>
}

/**
 * Test that verifies all expected activities exist with required server structure
 */
void test('all expected activities exist with required server files', () => {
  const activitiesDir = join(__dirname, '../../activities')

  for (const activityId of EXPECTED_ACTIVITIES) {
    const activityPath = join(activitiesDir, activityId)
    const configPath = resolveActivityConfigPath(activityPath)
    const serverDir = join(activityPath, 'server')
    const serverRoutes = resolveServerEntryPath(serverDir)

    assert.ok(
      existsSync(activityPath) && statSync(activityPath).isDirectory(),
      `Activity directory exists: ${activityId}`,
    )

    assert.ok(
      Boolean(configPath),
      `Activity config exists: ${activityId}/activity.config.{js,ts}`,
    )

    assert.ok(
      existsSync(serverDir) && statSync(serverDir).isDirectory(),
      `Server directory exists: ${activityId}/server`,
    )

    assert.ok(
      Boolean(serverRoutes),
      `Server routes exist: ${activityId}/server/routes.{js,ts}`,
    )
  }
})

/**
 * Test that verifies no unexpected activities exist
 * Dev activities (with isDev: true) are allowed and ignored
 */
void test('no unexpected activities in activities directory', async () => {
  const activitiesDir = join(__dirname, '../../activities')
  const entries = readdirSync(activitiesDir)

  const activityDirs = entries.filter((entry) => {
    const entryPath = join(activitiesDir, entry)
    return statSync(entryPath).isDirectory() && entry !== 'node_modules'
  })

  // Filter out dev activities by checking their configs
  const unexpectedActivities: string[] = []
  for (const dir of activityDirs) {
    if (EXPECTED_ACTIVITIES.includes(dir)) continue

    const configPath = resolveActivityConfigPath(join(activitiesDir, dir))
    if (configPath) {
      try {
        const config = await importActivityConfig(configPath)
        // Only flag as unexpected if it's NOT a dev activity
        if (!config.isDev) {
          unexpectedActivities.push(dir)
        }
      } catch (err) {
        // If config can't be loaded, log the error and flag as unexpected
        console.error(`Failed to load config for activity "${dir}":`, err)
        unexpectedActivities.push(dir)
      }
    } else {
      unexpectedActivities.push(dir)
    }
  }

  assert.deepEqual(unexpectedActivities, [], `Found unexpected non-dev activities: ${unexpectedActivities.join(', ')}`)
})

/**
 * Test that verifies the activity count matches expectations
 * Excludes dev activities from the count
 */
void test('activity count matches expected count', async () => {
  const activitiesDir = join(__dirname, '../../activities')
  const entries = readdirSync(activitiesDir)

  const activityDirs = entries.filter((entry) => {
    const entryPath = join(activitiesDir, entry)
    return statSync(entryPath).isDirectory() && entry !== 'node_modules' && Boolean(resolveActivityConfigPath(entryPath))
  })

  // Filter out dev activities
  let nonDevActivityCount = 0
  for (const dir of activityDirs) {
    const configPath = resolveActivityConfigPath(join(activitiesDir, dir))
    if (!configPath) {
      continue
    }
    try {
      const config = await importActivityConfig(configPath)
      if (!config.isDev) {
        nonDevActivityCount++
      }
    } catch (err) {
      // If config can't be loaded, count it as non-dev
      console.error(`Failed to load config for activity "${dir}" at "${configPath}":`, err)
      nonDevActivityCount++
    }
  }

  assert.equal(
    nonDevActivityCount,
    EXPECTED_ACTIVITIES.length,
    `Expected ${EXPECTED_ACTIVITIES.length} non-dev activities, found ${nonDevActivityCount}`,
  )
})

/**
 * Test that verifies each activity config has required fields
 */
void test('all activity configs have required fields', async () => {
  const activitiesDir = join(__dirname, '../../activities')

  for (const activityId of EXPECTED_ACTIVITIES) {
    const configPath = resolveActivityConfigPath(join(activitiesDir, activityId))
    assert.ok(configPath, `${activityId}: config exists at activity.config.{js,ts}`)
    const config = await importActivityConfig(configPath)

    assert.ok(config.id, `${activityId}: config has 'id' field`)
    assert.equal(config.id, activityId, `${activityId}: config.id matches directory name`)
    assert.ok(config.name, `${activityId}: config has 'name' field`)
    assert.ok(config.description, `${activityId}: config has 'description' field`)
    assert.ok(config.color, `${activityId}: config has 'color' field`)
    assert.ok(config.serverEntry, `${activityId}: config has 'serverEntry' field`)
    assert.equal(typeof config.soloMode, 'boolean', `${activityId}: config.soloMode is a boolean`)
    if (config.soloModeMeta !== undefined) {
      assert.equal(
        typeof config.soloModeMeta,
        'object',
        `${activityId}: config.soloModeMeta is an object when provided`,
      )
      if (config.soloModeMeta) {
        const { title, description, buttonText } = config.soloModeMeta
        if (title !== undefined) {
          assert.equal(typeof title, 'string', `${activityId}: soloModeMeta.title must be a string`)
        }
        if (description !== undefined) {
          assert.equal(typeof description, 'string', `${activityId}: soloModeMeta.description must be a string`)
        }
        if (buttonText !== undefined) {
          assert.equal(typeof buttonText, 'string', `${activityId}: soloModeMeta.buttonText must be a string`)
        }
      }
    }
  }
})

void test('registerActivityRoutes resolves server entry extension during mixed migration', async () => {
  const testRoot = join(__dirname, '../../activities/test-activity-ts')
  const testConfigPath = join(testRoot, 'activity.config.ts')
  const testServerDir = join(testRoot, 'server')
  const testRoutesPath = join(testServerDir, 'routes.ts')

  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true })
  }

  try {
    mkdirSync(testServerDir, { recursive: true })
    writeFileSync(
      testConfigPath,
      `export default {
  id: 'test-activity-ts',
  name: 'Test TS Activity',
  description: 'A test TypeScript activity',
  color: 'teal',
  soloMode: true,
  serverEntry: './server/routes.js',
};`
    )

    writeFileSync(
      testRoutesPath,
      `export default function register(app) {
  app.__registeredActivities = [...(app.__registeredActivities ?? []), 'test-activity-ts'];
}`
    )

    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const freshModule = await importRegistryModule()

      await freshModule.initializeActivityRegistry()
      const app: { __registeredActivities?: string[] } = {}
      console.log(
        '[TEST] registerActivityRoutes mixed-extension coverage uses minimal app/ws stubs; non-target activity route load errors are expected in output.',
      )
      await freshModule.registerActivityRoutes(app, {}, {})

      assert.ok(
        app.__registeredActivities?.includes('test-activity-ts'),
        'TS activity route module should register even when config serverEntry points to .js',
      )
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  } finally {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

/**
 * Tests for initializeActivityRegistry() and getAllowedActivities()
 * 
 * These tests verify the dev activity filtering mechanism:
 * 1. Production mode excludes activities with isDev: true
 * 2. Development mode includes all activities regardless of isDev flag
 * 3. getAllowedActivities() returns the correct filtered list
 * 4. Config load failures are handled appropriately in both modes
 * 5. Activities without isDev flag default to production (included)
 * 
 * Each test creates temporary activity configs and cleans them up after execution.
 */
void test('initializeActivityRegistry filters dev activities in production mode', async () => {
  // Create a temporary test directory structure
  const testRoot = join(__dirname, '../../activities/test-activity-dev')
  const testConfigPath = join(testRoot, 'activity.config.js')
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true })
  }
  
  try {
    // Create test activity with isDev: true
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(
      testConfigPath,
      `export default {
  id: 'test-activity-dev',
  name: 'Test Dev Activity',
  description: 'A test dev activity',
  color: 'blue',
  soloMode: true,
  isDev: true,
  clientEntry: './client/index.jsx',
  serverEntry: './server/routes.js',
};`
    )
    
    // Set production environment
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    
    // Re-import to get fresh module with new environment
    const freshModule = await importRegistryModule()
    await freshModule.initializeActivityRegistry()
    const allowedActivities = freshModule.getAllowedActivities()
    
    // Verify dev activity is excluded in production
    assert.ok(
      !allowedActivities.includes('test-activity-dev'),
      'Dev activity should be excluded in production mode',
    )
    
    // Restore environment
    process.env.NODE_ENV = originalEnv
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

void test('initializeActivityRegistry preserves dev activities in development mode', async () => {
  // Create a temporary test directory structure
  const testRoot = join(__dirname, '../../activities/test-activity-dev2')
  const testConfigPath = join(testRoot, 'activity.config.js')
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true })
  }
  
  try {
    // Create test activity with isDev: true
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(
      testConfigPath,
      `export default {
  id: 'test-activity-dev2',
  name: 'Test Dev Activity 2',
  description: 'A test dev activity',
  color: 'green',
  soloMode: false,
  isDev: true,
  clientEntry: './client/index.jsx',
  serverEntry: './server/routes.js',
};`
    )
    
    // Set development environment
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    
    // Re-import to get fresh module with new environment
    const freshModule = await importRegistryModule()
    await freshModule.initializeActivityRegistry()
    const allowedActivities = freshModule.getAllowedActivities()
    
    // Verify dev activity is included in development
    assert.ok(
      allowedActivities.includes('test-activity-dev2'),
      'Dev activity should be included in development mode',
    )
    
    // Restore environment
    process.env.NODE_ENV = originalEnv
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

void test('registry treats ENOENT for disappeared discovered config as skippable race', async () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'activity-registry-missing-race-'))
  const testConfigPath = join(testRoot, 'activity.config.js')

  try {
    const missingErr = Object.assign(
      new Error(`ENOENT: no such file or directory, open '${testConfigPath}'`),
      { code: 'ENOENT', path: testConfigPath },
    )
    assert.equal(
      isMissingDiscoveredConfigError(missingErr, testConfigPath),
      true,
      'ENOENT for missing discovered config should be skippable',
    )

    writeFileSync(testConfigPath, 'placeholder\n')
    assert.equal(
      isMissingDiscoveredConfigError(missingErr, testConfigPath),
      false,
      'Existing config path should not be treated as disappeared',
    )
  } finally {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

void test('getAllowedActivities returns correct filtered list after initialization', async () => {
  const { initializeActivityRegistry, getAllowedActivities } = await importRegistryModule()

  // Initialize
  await initializeActivityRegistry()

  // Get list after initialization
  const afterInit = getAllowedActivities()

  // Verify list is an array
  assert.ok(Array.isArray(afterInit), 'getAllowedActivities should return an array')

  // Verify all production activities are included
  for (const activity of EXPECTED_ACTIVITIES) {
    assert.ok(
      afterInit.includes(activity),
      `Expected production activity "${activity}" should be in allowed list`,
    )
  }

  // Verify the list doesn't include any undefined or null values
  assert.ok(
    afterInit.every((id) => id.length > 0),
    'All activity IDs should be non-empty strings',
  )
})

void test('initializeActivityRegistry handles config load failure in production', async () => {
  // Create a temporary test directory with a broken config
  const testRoot = join(__dirname, '../../activities/test-activity-broken')
  const testConfigPath = join(testRoot, 'activity.config.js')
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true })
  }
  
  try {
    // Create test activity with invalid config
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(
      testConfigPath,
      `export default {
  // Intentionally broken config - missing required fields
  this will cause a syntax error
};`
    )
    
    // Set production environment
    const originalEnv = process.env.NODE_ENV
    const originalExit = process.exit
    process.env.NODE_ENV = 'production'
    
    // Mock process.exit to capture the call
    let exitCalled = false
    let exitCode: number | string | null | undefined = null
    process.exit = ((code?: number | string | null): never => {
      exitCalled = true
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }) as typeof process.exit
    
    try {
      // Re-import to get fresh module with broken config
      const freshModule = await importRegistryModule()

      console.log('[TEST] Expected production config-load error output follows for intentionally broken activity config.')

      // This should trigger process.exit(1) in production
      await assert.rejects(
        async () => await freshModule.initializeActivityRegistry(),
        (err: unknown) => err instanceof Error && err.message === 'process.exit(1)',
        'Should call process.exit(1) when config fails to load in production',
      )

      assert.ok(exitCalled, 'process.exit should be called')
      assert.equal(exitCode, 1, 'Should exit with code 1')
    } finally {
      // Restore process.exit and environment
      process.exit = originalExit
      process.env.NODE_ENV = originalEnv
    }
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

void test('initializeActivityRegistry rejects schema-invalid activity config in production', async () => {
  const testRoot = join(__dirname, '../../activities/test-activity-invalid-schema')
  const testConfigPath = join(testRoot, 'activity.config.js')

  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true })
  }

  try {
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(
      testConfigPath,
      `export default {
  id: 'test-activity-invalid-schema',
  name: 'Test Invalid Schema Activity',
  description: 'Valid syntax but invalid shared contract',
  color: 'orange',
  soloMode: true,
  serverEntry: './server/routes.js',
  deepLinkGenerator: {
    endpoint: '/api/test',
    mode: 'wrong-mode',
  },
};`,
    )

    const originalEnv = process.env.NODE_ENV
    const originalExit = process.exit
    process.env.NODE_ENV = 'production'

    let exitCalled = false
    let exitCode: number | string | null | undefined = null
    process.exit = ((code?: number | string | null): never => {
      exitCalled = true
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }) as typeof process.exit

    try {
      const freshModule = await importRegistryModule()

      console.log('[TEST] Expected production schema-validation error output follows for intentionally invalid activity config.')

      await assert.rejects(
        async () => await freshModule.initializeActivityRegistry(),
        (err: unknown) => err instanceof Error && err.message === 'process.exit(1)',
      )

      assert.ok(exitCalled, 'process.exit should be called for schema-invalid config in production')
      assert.equal(exitCode, 1)
    } finally {
      process.exit = originalExit
      process.env.NODE_ENV = originalEnv
    }
  } finally {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

void test('initializeActivityRegistry handles config load failure in development', async () => {
  // Create a temporary test directory with a broken config
  const testRoot = join(__dirname, '../../activities/test-activity-broken-dev')
  const testConfigPath = join(testRoot, 'activity.config.js')
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true })
  }
  
  try {
    // Create test activity with invalid config
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(
      testConfigPath,
      `export default {
  // Intentionally broken config
  this will cause a syntax error
};`
    )
    
    // Set development environment
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    
    try {
      // Re-import to get fresh module
      const freshModule = await importRegistryModule()

      console.log('[TEST] Expected development warning output follows for intentionally broken activity config.')

      // In development, broken configs should not crash initialization
      // The activity should simply be discovered but the import will fail
      // This is acceptable in development mode
      await freshModule.initializeActivityRegistry()

      // If we get here without throwing, development mode is more permissive
      assert.ok(true, 'Development mode should be more permissive with config errors')
    } finally {
      // Restore environment
      process.env.NODE_ENV = originalEnv
    }
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

void test('initializeActivityRegistry handles missing isDev flag (defaults to production)', async () => {
  // Create a temporary test directory with config without isDev flag
  const testRoot = join(__dirname, '../../activities/test-activity-no-flag')
  const testConfigPath = join(testRoot, 'activity.config.js')
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true })
  }
  
  try {
    // Create test activity without isDev flag
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(
      testConfigPath,
      `export default {
  id: 'test-activity-no-flag',
  name: 'Test Activity No Flag',
  description: 'A test activity without isDev flag',
  color: 'purple',
  soloMode: true,
  clientEntry: './client/index.jsx',
  serverEntry: './server/routes.js',
};`
    )
    
    // Set production environment
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    
    try {
      // Re-import to get fresh module
      const freshModule = await importRegistryModule()

      await freshModule.initializeActivityRegistry()
      const allowedActivities = freshModule.getAllowedActivities()
      
      // Activity without isDev flag should be included (defaults to production)
      assert.ok(
        allowedActivities.includes('test-activity-no-flag'),
        'Activity without isDev flag should be included in production',
      )
    } finally {
      // Restore environment
      process.env.NODE_ENV = originalEnv
    }
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true })
    }
  }
})

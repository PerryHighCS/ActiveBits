import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Counter for cache-busting module imports to avoid race conditions
let testImportCounter = 0;

/**
 * Expected activities in the system (excluding dev-only activities)
 * Update this list when adding or removing production activities
 * Dev activities (with isDev: true) are automatically excluded from these tests
 */
const EXPECTED_ACTIVITIES = [
  "java-string-practice",
  "java-format-practice",
  "python-list-practice",
  "raffle",
  "www-sim",
];

/**
 * Test that verifies all expected activities exist with required server structure
 */
test("all expected activities exist with required server files", () => {
  const activitiesDir = join(__dirname, "../../activities");
  
  for (const activityId of EXPECTED_ACTIVITIES) {
    const activityPath = join(activitiesDir, activityId);
    const configPath = join(activityPath, "activity.config.js");
    const serverDir = join(activityPath, "server");
    const serverRoutes = join(serverDir, "routes.js");
    
    assert.ok(
      existsSync(activityPath) && statSync(activityPath).isDirectory(),
      `Activity directory exists: ${activityId}`
    );
    
    assert.ok(
      existsSync(configPath),
      `Activity config exists: ${activityId}/activity.config.js`
    );
    
    assert.ok(
      existsSync(serverDir) && statSync(serverDir).isDirectory(),
      `Server directory exists: ${activityId}/server`
    );
    
    assert.ok(
      existsSync(serverRoutes),
      `Server routes exist: ${activityId}/server/routes.js`
    );
  }
});

/**
 * Test that verifies no unexpected activities exist
 * Dev activities (with isDev: true) are allowed and ignored
 */
test("no unexpected activities in activities directory", async () => {
  const activitiesDir = join(__dirname, "../../activities");
  const entries = readdirSync(activitiesDir);
  
  const activityDirs = entries.filter(entry => {
    const entryPath = join(activitiesDir, entry);
    return statSync(entryPath).isDirectory() && entry !== "node_modules";
  });
  
  // Filter out dev activities by checking their configs
  const unexpectedActivities = [];
  for (const dir of activityDirs) {
    if (EXPECTED_ACTIVITIES.includes(dir)) continue;
    
    const configPath = join(activitiesDir, dir, "activity.config.js");
    if (existsSync(configPath)) {
      try {
        const { default: config } = await import(pathToFileURL(configPath).href);
        // Only flag as unexpected if it's NOT a dev activity
        if (!config.isDev) {
          unexpectedActivities.push(dir);
        }
      } catch (err) {
        // If config can't be loaded, log the error and flag as unexpected
        console.error(`Failed to load config for activity "${dir}":`, err);
        unexpectedActivities.push(dir);
      }
    } else {
      unexpectedActivities.push(dir);
    }
  }
  
  assert.deepEqual(
    unexpectedActivities,
    [],
    `Found unexpected non-dev activities: ${unexpectedActivities.join(", ")}`
  );
});

/**
 * Test that verifies the activity count matches expectations
 * Excludes dev activities from the count
 */
test("activity count matches expected count", async () => {
  const activitiesDir = join(__dirname, "../../activities");
  const entries = readdirSync(activitiesDir);
  
  const activityDirs = entries.filter(entry => {
    const entryPath = join(activitiesDir, entry);
    return statSync(entryPath).isDirectory() && 
           entry !== "node_modules" &&
           existsSync(join(entryPath, "activity.config.js"));
  });
  
  // Filter out dev activities
  let nonDevActivityCount = 0;
  for (const dir of activityDirs) {
    const configPath = join(activitiesDir, dir, "activity.config.js");
    try {
      const { default: config } = await import(pathToFileURL(configPath).href);
      if (!config.isDev) {
        nonDevActivityCount++;
      }
    } catch (err) {
      // If config can't be loaded, count it as non-dev
      console.error(`Failed to load config for activity "${dir}" at "${configPath}":`, err);
      nonDevActivityCount++;
    }
  }
  
  assert.equal(
    nonDevActivityCount,
    EXPECTED_ACTIVITIES.length,
    `Expected ${EXPECTED_ACTIVITIES.length} non-dev activities, found ${nonDevActivityCount}`
  );
});

/**
 * Test that verifies each activity config has required fields
 */
test("all activity configs have required fields", async () => {
  const activitiesDir = join(__dirname, "../../activities");
  
  for (const activityId of EXPECTED_ACTIVITIES) {
    const configPath = join(activitiesDir, activityId, "activity.config.js");
    const configUrl = pathToFileURL(configPath).href;
    const { default: config } = await import(configUrl);
    
    assert.ok(config.id, `${activityId}: config has 'id' field`);
    assert.equal(config.id, activityId, `${activityId}: config.id matches directory name`);
    assert.ok(config.name, `${activityId}: config has 'name' field`);
    assert.ok(config.description, `${activityId}: config has 'description' field`);
    assert.ok(config.color, `${activityId}: config has 'color' field`);
    assert.ok(config.serverEntry, `${activityId}: config has 'serverEntry' field`);
    assert.equal(
      typeof config.soloMode,
      "boolean",
      `${activityId}: config.soloMode is a boolean`
    );
  }
});

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
test("initializeActivityRegistry filters dev activities in production mode", async (t) => {
  // Create a temporary test directory structure
  const testRoot = join(__dirname, "../../activities/test-activity-dev");
  const testConfigPath = join(testRoot, "activity.config.js");
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
  
  try {
    // Create test activity with isDev: true
    mkdirSync(testRoot, { recursive: true });
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
    );
    
    // Set production environment
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    // Re-import to get fresh module with new environment
    const moduleUrl = pathToFileURL(join(__dirname, 'activityRegistry.js')).href;
    const freshModule = await import(`${moduleUrl}?t=${Date.now()}-${testImportCounter++}`);
    
    await freshModule.initializeActivityRegistry();
    const allowedActivities = freshModule.getAllowedActivities();
    
    // Verify dev activity is excluded in production
    assert.ok(
      !allowedActivities.includes('test-activity-dev'),
      'Dev activity should be excluded in production mode'
    );
    
    // Restore environment
    process.env.NODE_ENV = originalEnv;
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }
});

test("initializeActivityRegistry preserves dev activities in development mode", async (t) => {
  // Create a temporary test directory structure
  const testRoot = join(__dirname, "../../activities/test-activity-dev2");
  const testConfigPath = join(testRoot, "activity.config.js");
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
  
  try {
    // Create test activity with isDev: true
    mkdirSync(testRoot, { recursive: true });
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
    );
    
    // Set development environment
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    // Re-import to get fresh module with new environment
    const moduleUrl = pathToFileURL(join(__dirname, 'activityRegistry.js')).href;
    const freshModule = await import(`${moduleUrl}?t=${Date.now()}-${testImportCounter++}`);
    
    await freshModule.initializeActivityRegistry();
    const allowedActivities = freshModule.getAllowedActivities();
    
    // Verify dev activity is included in development
    assert.ok(
      allowedActivities.includes('test-activity-dev2'),
      'Dev activity should be included in development mode'
    );
    
    // Restore environment
    process.env.NODE_ENV = originalEnv;
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }
});

test("getAllowedActivities returns correct filtered list after initialization", async (t) => {
  const { initializeActivityRegistry, getAllowedActivities } = await import(
    pathToFileURL(join(__dirname, 'activityRegistry.js')).href + `?t=${Date.now()}-${testImportCounter++}`
  );
  
  // Initialize
  await initializeActivityRegistry();
  
  // Get list after initialization
  const afterInit = getAllowedActivities();
  
  // Verify list is an array
  assert.ok(Array.isArray(afterInit), 'getAllowedActivities should return an array');
  
  // Verify all production activities are included
  for (const activity of EXPECTED_ACTIVITIES) {
    assert.ok(
      afterInit.includes(activity),
      `Expected production activity "${activity}" should be in allowed list`
    );
  }
  
  // Verify the list doesn't include any undefined or null values
  assert.ok(
    afterInit.every(id => id && typeof id === 'string'),
    'All activity IDs should be non-empty strings'
  );
});

test("initializeActivityRegistry handles config load failure in production", async (t) => {
  // Create a temporary test directory with a broken config
  const testRoot = join(__dirname, "../../activities/test-activity-broken");
  const testConfigPath = join(testRoot, "activity.config.js");
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
  
  try {
    // Create test activity with invalid config
    mkdirSync(testRoot, { recursive: true });
    writeFileSync(
      testConfigPath,
      `export default {
  // Intentionally broken config - missing required fields
  this will cause a syntax error
};`
    );
    
    // Set production environment
    const originalEnv = process.env.NODE_ENV;
    const originalExit = process.exit;
    process.env.NODE_ENV = 'production';
    
    // Mock process.exit to capture the call
    let exitCalled = false;
    let exitCode = null;
    process.exit = (code) => {
      exitCalled = true;
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    
    try {
      // Re-import to get fresh module with broken config
      const moduleUrl = pathToFileURL(join(__dirname, 'activityRegistry.js')).href;
      const freshModule = await import(`${moduleUrl}?t=${Date.now()}-${testImportCounter++}`);
      
      // This should trigger process.exit(1) in production
      await assert.rejects(
        async () => await freshModule.initializeActivityRegistry(),
        (err) => err.message === 'process.exit(1)',
        'Should call process.exit(1) when config fails to load in production'
      );
      
      assert.ok(exitCalled, 'process.exit should be called');
      assert.equal(exitCode, 1, 'Should exit with code 1');
    } finally {
      // Restore process.exit and environment
      process.exit = originalExit;
      process.env.NODE_ENV = originalEnv;
    }
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }
});

test("initializeActivityRegistry handles config load failure in development", async (t) => {
  // Create a temporary test directory with a broken config
  const testRoot = join(__dirname, "../../activities/test-activity-broken-dev");
  const testConfigPath = join(testRoot, "activity.config.js");
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
  
  try {
    // Create test activity with invalid config
    mkdirSync(testRoot, { recursive: true });
    writeFileSync(
      testConfigPath,
      `export default {
  // Intentionally broken config
  this will cause a syntax error
};`
    );
    
    // Set development environment
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    try {
      // Re-import to get fresh module
      const moduleUrl = pathToFileURL(join(__dirname, 'activityRegistry.js')).href;
      const freshModule = await import(`${moduleUrl}?t=${Date.now()}-${testImportCounter++}`);
      
      // In development, broken configs should not crash initialization
      // The activity should simply be discovered but the import will fail
      // This is acceptable in development mode
      await freshModule.initializeActivityRegistry();
      
      // If we get here without throwing, development mode is more permissive
      assert.ok(true, 'Development mode should be more permissive with config errors');
    } finally {
      // Restore environment
      process.env.NODE_ENV = originalEnv;
    }
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }
});

test("initializeActivityRegistry handles missing isDev flag (defaults to production)", async (t) => {
  // Create a temporary test directory with config without isDev flag
  const testRoot = join(__dirname, "../../activities/test-activity-no-flag");
  const testConfigPath = join(testRoot, "activity.config.js");
  
  // Clean up before test
  if (existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
  
  try {
    // Create test activity without isDev flag
    mkdirSync(testRoot, { recursive: true });
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
    );
    
    // Set production environment
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    try {
      // Re-import to get fresh module
      const moduleUrl = pathToFileURL(join(__dirname, 'activityRegistry.js')).href;
      const freshModule = await import(`${moduleUrl}?t=${Date.now()}-${testImportCounter++}`);
      
      await freshModule.initializeActivityRegistry();
      const allowedActivities = freshModule.getAllowedActivities();
      
      // Activity without isDev flag should be included (defaults to production)
      assert.ok(
        allowedActivities.includes('test-activity-no-flag'),
        'Activity without isDev flag should be included in production'
      );
    } finally {
      // Restore environment
      process.env.NODE_ENV = originalEnv;
    }
  } finally {
    // Clean up test files
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }
});

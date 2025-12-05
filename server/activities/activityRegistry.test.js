import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Expected activities in the system (excluding dev-only activities)
 * Update this list when adding or removing production activities
 * Dev activities (with isDev: true) are automatically excluded from these tests
 */
const EXPECTED_ACTIVITIES = [
  "java-string-practice",
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

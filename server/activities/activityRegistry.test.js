import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Expected activities in the system
 * Update this list when adding or removing activities
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
 */
test("no unexpected activities in activities directory", () => {
  const activitiesDir = join(__dirname, "../../activities");
  const entries = readdirSync(activitiesDir);
  
  const activityDirs = entries.filter(entry => {
    const entryPath = join(activitiesDir, entry);
    return statSync(entryPath).isDirectory() && entry !== "node_modules";
  });
  
  const unexpectedActivities = activityDirs.filter(
    dir => !EXPECTED_ACTIVITIES.includes(dir)
  );
  
  assert.deepEqual(
    unexpectedActivities,
    [],
    `Found unexpected activities: ${unexpectedActivities.join(", ")}`
  );
});

/**
 * Test that verifies the activity count matches expectations
 */
test("activity count matches expected count", () => {
  const activitiesDir = join(__dirname, "../../activities");
  const entries = readdirSync(activitiesDir);
  
  const activityDirs = entries.filter(entry => {
    const entryPath = join(activitiesDir, entry);
    return statSync(entryPath).isDirectory() && 
           entry !== "node_modules" &&
           existsSync(join(entryPath, "activity.config.js"));
  });
  
  assert.equal(
    activityDirs.length,
    EXPECTED_ACTIVITIES.length,
    `Expected ${EXPECTED_ACTIVITIES.length} activities, found ${activityDirs.length}`
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

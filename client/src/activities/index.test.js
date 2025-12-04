import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
 * Test that verifies all expected activities exist and are properly structured
 */
test("all expected activities exist with required files", () => {
  const activitiesDir = join(__dirname, "../../../activities");
  
  for (const activityId of EXPECTED_ACTIVITIES) {
    const activityPath = join(activitiesDir, activityId);
    const configPath = join(activityPath, "activity.config.js");
    const clientDir = join(activityPath, "client");
    const clientIndexJs = join(clientDir, "index.js");
    const clientIndexJsx = join(clientDir, "index.jsx");
    
    assert.ok(
      statSync(activityPath).isDirectory(),
      `Activity directory exists: ${activityId}`
    );
    
    assert.ok(
      existsSync(configPath),
      `Activity config exists: ${activityId}/activity.config.js`
    );
    
    assert.ok(
      statSync(clientDir).isDirectory(),
      `Client directory exists: ${activityId}/client`
    );
    
    assert.ok(
      existsSync(clientIndexJs) || existsSync(clientIndexJsx),
      `Client entry point exists: ${activityId}/client/index.{js,jsx}`
    );
  }
});

/**
 * Test that verifies no unexpected activities exist
 */
test("no unexpected activities in activities directory", () => {
  const activitiesDir = join(__dirname, "../../../activities");
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
  const activitiesDir = join(__dirname, "../../../activities");
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

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, existsSync } from "node:fs";
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
  "algorithm-demo",
  "java-string-practice",
  "java-format-practice",
  "python-list-practice",
  "raffle",
  "gallery-walk",
  "traveling-salesman",
  "www-sim",
];

const CONFIG_FILE_CANDIDATES = ["activity.config.ts", "activity.config.js"];
const CLIENT_ENTRY_CANDIDATES = ["index.tsx", "index.ts", "index.jsx", "index.js"];

function firstExistingPath(paths) {
  return paths.find(path => existsSync(path)) || null;
}

function resolveActivityConfigPath(activityPath) {
  return firstExistingPath(CONFIG_FILE_CANDIDATES.map(filename => join(activityPath, filename)));
}

function resolveActivityClientEntryPath(clientPath) {
  return firstExistingPath(CLIENT_ENTRY_CANDIDATES.map(filename => join(clientPath, filename)));
}

/**
 * Test that verifies all expected activities exist and are properly structured
 */
test("all expected activities exist with required files", () => {
  const activitiesDir = join(__dirname, "../../../activities");
  
  for (const activityId of EXPECTED_ACTIVITIES) {
    const activityPath = join(activitiesDir, activityId);
    const configPath = resolveActivityConfigPath(activityPath);
    const clientDir = join(activityPath, "client");
    const clientEntryPath = resolveActivityClientEntryPath(clientDir);
    
    assert.ok(
      existsSync(activityPath) && statSync(activityPath).isDirectory(),
      `Activity directory exists: ${activityId}`
    );
    
    assert.ok(
      Boolean(configPath),
      `Activity config exists: ${activityId}/activity.config.{js,ts}`
    );
    
    assert.ok(
      existsSync(clientDir) && statSync(clientDir).isDirectory(),
      `Client directory exists: ${activityId}/client`
    );
    
    assert.ok(
      Boolean(clientEntryPath),
      `Client entry point exists: ${activityId}/client/index.{js,jsx,ts,tsx}`
    );
  }
});

/**
 * Test that verifies no unexpected activities exist
 * Dev activities (with isDev: true) are allowed and ignored
 */
test("no unexpected activities in activities directory", async () => {
  const activitiesDir = join(__dirname, "../../../activities");
  const entries = readdirSync(activitiesDir);
  
  const activityDirs = entries.filter(entry => {
    const entryPath = join(activitiesDir, entry);
    return statSync(entryPath).isDirectory() && entry !== "node_modules";
  });
  
  // Filter out dev activities by checking their configs
  const unexpectedActivities = [];
  for (const dir of activityDirs) {
    if (EXPECTED_ACTIVITIES.includes(dir)) continue;
    
    const configPath = resolveActivityConfigPath(join(activitiesDir, dir));
    if (configPath) {
      try {
        const { default: config } = await import(pathToFileURL(configPath).href);
        // Only flag as unexpected if it's NOT a dev activity
        if (!config.isDev) {
          unexpectedActivities.push(dir);
        }
      } catch (err) {
        // If config can't be loaded, flag as unexpected
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
  const activitiesDir = join(__dirname, "../../../activities");
  const entries = readdirSync(activitiesDir);
  
  const activityDirs = entries.filter(entry => {
    const entryPath = join(activitiesDir, entry);
    return statSync(entryPath).isDirectory() && 
           entry !== "node_modules" &&
           resolveActivityConfigPath(entryPath);
  });
  
  // Filter out dev activities
  let nonDevActivityCount = 0;
  for (const dir of activityDirs) {
    const configPath = resolveActivityConfigPath(join(activitiesDir, dir));
    try {
      const { default: config } = await import(pathToFileURL(configPath).href);
      if (!config.isDev) {
        nonDevActivityCount++;
      }
    } catch (err) {
      // If config can't be loaded, count it as non-dev
      console.error(`Failed to load config for activity "${dir}":`, err);
      nonDevActivityCount++;
    }
  }
  
  assert.equal(
    nonDevActivityCount,
    EXPECTED_ACTIVITIES.length,
    `Expected ${EXPECTED_ACTIVITIES.length} non-dev activities, found ${nonDevActivityCount}`
  );
});

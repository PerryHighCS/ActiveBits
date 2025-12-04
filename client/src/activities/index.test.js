import test from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for activity registry path parsing logic
 * 
 * These tests verify that the activity ID extraction works correctly
 * regardless of whether Vite resolves the @activities alias to a relative
 * path or keeps it as the alias.
 */

// Extract the path parsing logic to test it independently
function extractActivityIdFromPath(path) {
  const pathParts = path.split(/[@\/]activities\//)[1]?.split('/');
  return pathParts?.[0];
}

function findClientModuleKey(clientModuleKeys, activityId) {
  return clientModuleKeys.find(k => 
    k.includes(`/${activityId}/client/index`) || k.includes(`@activities/${activityId}/client/index`)
  );
}

test("extractActivityIdFromPath handles @activities alias format", () => {
  const path = "@activities/java-string-practice/activity.config.js";
  const activityId = extractActivityIdFromPath(path);
  assert.equal(activityId, "java-string-practice");
});

test("extractActivityIdFromPath handles resolved relative path format", () => {
  const path = "../activities/python-list-practice/activity.config.js";
  const activityId = extractActivityIdFromPath(path);
  assert.equal(activityId, "python-list-practice");
});

test("extractActivityIdFromPath handles absolute path format", () => {
  const path = "/workspaces/ActiveBits/activities/raffle/activity.config.js";
  const activityId = extractActivityIdFromPath(path);
  assert.equal(activityId, "raffle");
});

test("extractActivityIdFromPath handles path with /activities/ subdirectory", () => {
  const path = "/some/path/activities/www-sim/activity.config.js";
  const activityId = extractActivityIdFromPath(path);
  assert.equal(activityId, "www-sim");
});

test("findClientModuleKey finds module with alias format", () => {
  const keys = [
    "@activities/java-string-practice/client/index.js",
    "@activities/python-list-practice/client/index.jsx",
    "@activities/raffle/client/index.jsx",
  ];
  
  const found = findClientModuleKey(keys, "python-list-practice");
  assert.equal(found, "@activities/python-list-practice/client/index.jsx");
});

test("findClientModuleKey finds module with resolved relative path", () => {
  const keys = [
    "../activities/java-string-practice/client/index.js",
    "../activities/python-list-practice/client/index.jsx",
    "../activities/raffle/client/index.jsx",
  ];
  
  const found = findClientModuleKey(keys, "java-string-practice");
  assert.equal(found, "../activities/java-string-practice/client/index.js");
});

test("findClientModuleKey finds module with absolute path", () => {
  const keys = [
    "/workspaces/ActiveBits/activities/java-string-practice/client/index.js",
    "/workspaces/ActiveBits/activities/python-list-practice/client/index.jsx",
  ];
  
  const found = findClientModuleKey(keys, "java-string-practice");
  assert.equal(found, "/workspaces/ActiveBits/activities/java-string-practice/client/index.js");
});

test("findClientModuleKey handles .js and .jsx extensions", () => {
  const keys = [
    "../activities/raffle/client/index.jsx",
    "../activities/www-sim/client/index.js",
  ];
  
  const foundJsx = findClientModuleKey(keys, "raffle");
  const foundJs = findClientModuleKey(keys, "www-sim");
  
  assert.equal(foundJsx, "../activities/raffle/client/index.jsx");
  assert.equal(foundJs, "../activities/www-sim/client/index.js");
});

test("findClientModuleKey returns undefined for non-existent activity", () => {
  const keys = [
    "@activities/java-string-practice/client/index.js",
  ];
  
  const found = findClientModuleKey(keys, "non-existent-activity");
  assert.equal(found, undefined);
});

test("extractActivityIdFromPath handles mixed formats in same codebase", () => {
  const paths = [
    "@activities/activity-one/activity.config.js",
    "../activities/activity-two/activity.config.js",
    "/full/path/activities/activity-three/activity.config.js",
  ];
  
  const ids = paths.map(extractActivityIdFromPath);
  
  assert.deepEqual(ids, ["activity-one", "activity-two", "activity-three"]);
});

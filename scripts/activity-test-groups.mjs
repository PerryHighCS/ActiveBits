import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFilePath);
export const repoRoot = resolve(scriptDir, '..');
const manifestPath = resolve(repoRoot, 'ci/activity-test-groups.json');
const activitiesRoot = resolve(repoRoot, 'activities');

function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${path}: ${message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${path}: ${message}`);
  }
}

export function loadActivityTestGroups() {
  const manifest = readJson(manifestPath);

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.groups)) {
    throw new Error('ci/activity-test-groups.json must contain a top-level "groups" array.');
  }

  return manifest.groups;
}

export function discoverActivities() {
  try {
    return readdirSync(activitiesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read activities directory: ${message}`);
  }
}

export function validateActivityTestGroups(groups) {
  const discoveredActivities = discoverActivities();
  const discoveredSet = new Set(discoveredActivities);
  const assignedCounts = new Map();
  const groupNames = new Set();

  if (groups.length === 0) {
    throw new Error('ci/activity-test-groups.json must define at least one group.');
  }

  for (const [index, group] of groups.entries()) {
    if (!group || typeof group !== 'object') {
      throw new Error(`Group at index ${index} must be an object.`);
    }

    const { name, activities } = group;

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`Group at index ${index} must have a non-empty string "name".`);
    }

    if (groupNames.has(name)) {
      throw new Error(`Duplicate group name "${name}" in ci/activity-test-groups.json.`);
    }
    groupNames.add(name);

    if (!Array.isArray(activities) || activities.length === 0) {
      throw new Error(`Group "${name}" must define a non-empty "activities" array.`);
    }

    for (const activity of activities) {
      if (typeof activity !== 'string' || activity.trim().length === 0) {
        throw new Error(`Group "${name}" contains an invalid activity entry.`);
      }

      if (!discoveredSet.has(activity)) {
        throw new Error(
          `Group "${name}" references unknown activity "${activity}". Add the directory first or fix the manifest.`,
        );
      }

      assignedCounts.set(activity, (assignedCounts.get(activity) ?? 0) + 1);
    }
  }

  const missingActivities = discoveredActivities.filter((activity) => !assignedCounts.has(activity));
  if (missingActivities.length > 0) {
    throw new Error(
      `Activities missing from ci/activity-test-groups.json: ${missingActivities.join(', ')}.`,
    );
  }

  const duplicatedActivities = [...assignedCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([activity]) => activity);
  if (duplicatedActivities.length > 0) {
    throw new Error(
      `Activities assigned to multiple groups in ci/activity-test-groups.json: ${duplicatedActivities.join(', ')}.`,
    );
  }

  return {
    groups,
    discoveredActivities,
  };
}

export function buildActivityTestMatrix(groups) {
  return {
    include: groups.map((group) => ({
      name: group.name,
      activities: group.activities,
    })),
  };
}

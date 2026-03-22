import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFilePath);
export const repoRoot = resolve(scriptDir, '..');
const activitiesRoot = resolve(repoRoot, 'activities');

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

function collectActivityTestFileCount(rootDir) {
  let count = 0;

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read activity test files in ${currentDir}: ${message}`);
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules') {
        continue;
      }

      const fullPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx'))
      ) {
        count += 1;
      }
    }
  }

  walk(rootDir);
  return count;
}

export function resolveActivityTestGroupCount(rawGroupCount = process.env.ACTIVITY_TEST_GROUP_COUNT ?? '3') {
  const parsed = Number.parseInt(String(rawGroupCount), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`ACTIVITY_TEST_GROUP_COUNT must be a positive integer. Received: ${rawGroupCount}`);
  }
  return parsed;
}

export function generateActivityTestGroups(groupCount) {
  const discoveredActivities = discoverActivities();
  if (discoveredActivities.length === 0) {
    throw new Error('No activities were discovered under activities/.');
  }

  if (groupCount > discoveredActivities.length) {
    throw new Error(
      `ACTIVITY_TEST_GROUP_COUNT (${groupCount}) cannot exceed discovered activity count (${discoveredActivities.length}).`,
    );
  }

  const activityWeights = discoveredActivities
    .map((activity) => ({
      activity,
      weight: collectActivityTestFileCount(resolve(activitiesRoot, activity)),
    }))
    .sort((left, right) => right.weight - left.weight || left.activity.localeCompare(right.activity));

  const groups = Array.from({ length: groupCount }, (_, index) => ({
    name: `group-${index + 1}`,
    activities: [],
    totalWeight: 0,
  }));

  for (const entry of activityWeights) {
    groups.sort((left, right) => left.totalWeight - right.totalWeight || left.name.localeCompare(right.name));
    groups[0].activities.push(entry.activity);
    groups[0].totalWeight += entry.weight;
  }

  return {
    groups: groups
      .map((group) => ({
        name: group.name,
        activities: group.activities.sort(),
        totalWeight: group.totalWeight,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    discoveredActivities,
  };
}

export function validateActivityTestGroups(groups, discoveredActivities = discoverActivities()) {
  const assignedCounts = new Map();
  const groupNames = new Set();

  if (groups.length === 0) {
    throw new Error('At least one activity test group must be generated.');
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
      throw new Error(`Duplicate generated group name "${name}".`);
    }
    groupNames.add(name);

    if (!Array.isArray(activities) || activities.length === 0) {
      throw new Error(`Group "${name}" must define a non-empty "activities" array.`);
    }

    for (const activity of activities) {
      assignedCounts.set(activity, (assignedCounts.get(activity) ?? 0) + 1);
    }
  }

  const missingActivities = discoveredActivities.filter((activity) => !assignedCounts.has(activity));
  if (missingActivities.length > 0) {
    throw new Error(`Generated groups are missing activities: ${missingActivities.join(', ')}.`);
  }

  const duplicatedActivities = [...assignedCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([activity]) => activity);
  if (duplicatedActivities.length > 0) {
    throw new Error(`Generated groups duplicate activities: ${duplicatedActivities.join(', ')}.`);
  }

  return { groups, discoveredActivities };
}

export function buildActivityTestMatrix(groups) {
  return {
    include: groups.map((group) => ({
      name: group.name,
      activities: group.activities,
    })),
  };
}

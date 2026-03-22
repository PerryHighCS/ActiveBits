import {
  buildActivityTestMatrix,
  loadActivityTestGroups,
  validateActivityTestGroups,
} from './activity-test-groups.mjs';

const emitMatrix = process.argv.includes('--matrix');

let validation;
try {
  validation = validateActivityTestGroups(loadActivityTestGroups());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[activity-test-groups] ${message}`);
  process.exit(1);
}

if (emitMatrix) {
  process.stdout.write(JSON.stringify(buildActivityTestMatrix(validation.groups)));
  process.exit(0);
}

console.log(
  `[activity-test-groups] OK: ${validation.groups.length} groups cover ${validation.discoveredActivities.length} activities.`,
);

import {
  buildActivityTestMatrix,
  generateActivityTestGroups,
  resolveActivityTestGroupCount,
  validateActivityTestGroups,
} from './activity-test-groups.mjs';

const emitMatrix = process.argv.includes('--matrix');

let validation;
try {
  const groupCount = resolveActivityTestGroupCount();
  const generated = generateActivityTestGroups(groupCount);
  validation = validateActivityTestGroups(generated.groups, generated.discoveredActivities);
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
  `[activity-test-groups] OK: ${validation.groups.length} generated groups cover ${validation.discoveredActivities.length} activities.`,
);

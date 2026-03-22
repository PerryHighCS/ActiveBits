import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { loadActivityTestGroups, repoRoot, validateActivityTestGroups } from './activity-test-groups.mjs';

const groupName = process.argv[2];

if (!groupName) {
  console.error('[activity-test-group] Usage: node scripts/run-activity-test-group.mjs <group-name>');
  process.exit(1);
}

let validation;
try {
  validation = validateActivityTestGroups(loadActivityTestGroups());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[activity-test-group] ${message}`);
  process.exit(1);
}

const group = validation.groups.find((entry) => entry.name === groupName);

if (!group) {
  console.error(`[activity-test-group] Unknown group "${groupName}".`);
  process.exit(1);
}

function formatElapsedMs(elapsedMs) {
  return `${(elapsedMs / 1000).toFixed(2)}s`;
}

const groupStartedAt = Date.now();

for (const activity of group.activities) {
  const activityStartedAt = Date.now();
  console.log(`::group::[activity-test-group] ${activity}`);
  console.log(`[activity-test-group] Running ${activity}...`);
  const result = spawnSync(
    'sh',
    [
      '-c',
      'set -e; activity="$1"; files=$(find "$activity" -path "*/node_modules/*" -prune -o \\( -name "*.test.ts" -o -name "*.test.tsx" \\) -print); if [ -z "$files" ]; then echo "No tests found under $activity"; exit 0; fi; node --import tsx --test --import ../scripts/jsx-loader-register.mjs $files',
      'sh',
      activity,
    ],
    {
      stdio: 'inherit',
      cwd: resolve(repoRoot, 'activities'),
    },
  );

  if (typeof result.status === 'number' && result.status !== 0) {
    console.log('::endgroup::');
    process.exit(result.status);
  }

  if (result.error) {
    console.log('::endgroup::');
    console.error(`[activity-test-group] Failed to run ${activity}: ${result.error.message}`);
    process.exit(1);
  }

  const activityElapsedMs = Date.now() - activityStartedAt;
  console.log(
    `[activity-test-group] ${activity} completed in ${formatElapsedMs(activityElapsedMs)}.`,
  );
  console.log('::endgroup::');
}

const groupElapsedMs = Date.now() - groupStartedAt;
console.log(
  `[activity-test-group] Completed ${group.activities.length} activities for group "${group.name}" in ${formatElapsedMs(groupElapsedMs)}.`,
);

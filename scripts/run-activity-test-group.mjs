import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';

import {
  generateActivityTestGroups,
  repoRoot,
  resolveActivityTestGroupCount,
  validateActivityTestGroups,
} from './activity-test-groups.mjs';

const groupName = process.argv[2];

if (!groupName) {
  console.error('[activity-test-group] Usage: node scripts/run-activity-test-group.mjs <group-name>');
  process.exit(1);
}

let validation;
try {
  const groupCount = resolveActivityTestGroupCount();
  const generated = generateActivityTestGroups(groupCount);
  validation = validateActivityTestGroups(generated.groups, generated.discoveredActivities);
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

function parseTestCount(output) {
  if (typeof output !== 'string' || output.length === 0) {
    return null;
  }

  const match = output.match(/^\u2139 tests (\d+)$/m);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectTestFiles(rootDir) {
  const testFiles = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });

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
        testFiles.push(fullPath);
      }
    }
  }

  walk(rootDir);
  testFiles.sort();
  return testFiles;
}

function toActivityRelativeTestFile(filePath) {
  const relativePath = relative(resolve(repoRoot, 'activities'), filePath);
  return sep === '/' ? relativePath : relativePath.split(sep).join('/');
}

const groupStartedAt = Date.now();
const activityTimings = [];

for (const activity of group.activities) {
  const activityStartedAt = Date.now();
  console.log(`::group::[activity-test-group] ${activity}`);
  console.log(`[activity-test-group] Running ${activity}...`);
  const activityDir = resolve(repoRoot, 'activities', activity);
  const testFiles = collectTestFiles(activityDir);

  if (testFiles.length === 0) {
    console.log(`[activity-test-group] No tests found under ${activity}.`);
    activityTimings.push({ activity, elapsedMs: 0, testCount: 0 });
    console.log('::endgroup::');
    continue;
  }

  const tempDir = mkdtempSync(resolve(tmpdir(), 'activebits-activity-test-'));
  const outputLogPath = resolve(tempDir, 'activity-output.log');
  const result = spawnSync(
    'bash',
    [
      '-lc',
      'set -euo pipefail; output_file="$1"; shift; node --import tsx --test --import ../scripts/jsx-loader-register.mjs "$@" 2>&1 | tee "$output_file"',
      'bash',
      outputLogPath,
      ...testFiles.map(toActivityRelativeTestFile),
    ],
    {
      stdio: 'inherit',
      cwd: resolve(repoRoot, 'activities'),
    },
  );

  if (result.error) {
    rmSync(tempDir, { recursive: true, force: true });
    console.log('::endgroup::');
    console.error(`[activity-test-group] Failed to run ${activity}: ${result.error.message}`);
    process.exit(1);
  }

  const capturedOutput = existsSync(outputLogPath) ? readFileSync(outputLogPath, 'utf8') : '';
  rmSync(tempDir, { recursive: true, force: true });

  if (typeof result.signal === 'string' && result.signal.length > 0) {
    console.log('::endgroup::');
    console.error(`[activity-test-group] ${activity} was terminated by signal ${result.signal}.`);
    process.exit(1);
  }

  if (result.status == null) {
    console.log('::endgroup::');
    console.error(`[activity-test-group] ${activity} exited without a status code.`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.log('::endgroup::');
    process.exit(result.status);
  }

  const activityElapsedMs = Date.now() - activityStartedAt;
  const testCount = parseTestCount(capturedOutput);
  activityTimings.push({ activity, elapsedMs: activityElapsedMs, testCount });
  console.log(
    `[activity-test-group] ${activity} completed in ${formatElapsedMs(activityElapsedMs)}.`,
  );
  console.log('::endgroup::');
}

const groupElapsedMs = Date.now() - groupStartedAt;
console.log('[activity-test-group] Activity timing summary:');
for (const timing of activityTimings) {
  const testLabel =
    typeof timing.testCount === 'number' ? `${timing.testCount} tests` : 'test count unavailable';
  console.log(`- ${timing.activity}: ${formatElapsedMs(timing.elapsedMs)} (${testLabel})`);
}
console.log(
  `[activity-test-group] Completed ${group.activities.length} activities for group "${group.name}" in ${formatElapsedMs(groupElapsedMs)}.`,
);

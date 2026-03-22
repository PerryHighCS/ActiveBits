import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFilePath);
const repoRoot = resolve(scriptDir, '..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const packageLockPath = resolve(repoRoot, 'package-lock.json');
const ciWorkflowPath = resolve(repoRoot, '.github/workflows/ci.yml');

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

function normalizePlaywrightVersion(value) {
  return String(value).trim().replace(/^[^\d]*/, '');
}

let packageJson;
try {
  packageJson = readJson(packageJsonPath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[playwright-version-sync] ${message}`);
  process.exit(1);
}

const packageRangeRaw = packageJson?.devDependencies?.['@playwright/test'];
if (typeof packageRangeRaw !== 'string' || packageRangeRaw.trim().length === 0) {
  console.error('[playwright-version-sync] package.json is missing devDependencies["@playwright/test"].');
  process.exit(1);
}

let packageLock;
try {
  packageLock = readJson(packageLockPath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[playwright-version-sync] ${message}`);
  process.exit(1);
}

const lockedVersionRaw = packageLock?.packages?.['node_modules/@playwright/test']?.version;
if (typeof lockedVersionRaw !== 'string' || lockedVersionRaw.trim().length === 0) {
  console.error(
    '[playwright-version-sync] package-lock.json is missing packages["node_modules/@playwright/test"].version.',
  );
  process.exit(1);
}

const expectedVersion = normalizePlaywrightVersion(lockedVersionRaw);
if (!expectedVersion) {
  console.error(
    `[playwright-version-sync] Could not normalize locked @playwright/test version from ${lockedVersionRaw}.`,
  );
  process.exit(1);
}

let workflowRaw;
try {
  workflowRaw = readFileSync(ciWorkflowPath, 'utf8');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[playwright-version-sync] Unable to read ${ciWorkflowPath}: ${message}`);
  process.exit(1);
}

const envTagPattern =
  /PLAYWRIGHT_CONTAINER_IMAGE:\s*mcr\.microsoft\.com\/playwright:v([0-9]+\.[0-9]+\.[0-9]+)(?:-[^\s'"]+)?/;
const inlineTagPattern =
  /mcr\.microsoft\.com\/playwright:v([0-9]+\.[0-9]+\.[0-9]+)(?:-[^\s'"]+)?/;
const match = workflowRaw.match(envTagPattern) ?? workflowRaw.match(inlineTagPattern);

if (!match) {
  console.log(
    `[playwright-version-sync] OK: no Playwright container image is configured in .github/workflows/ci.yml; browser jobs will use the installed Playwright ${expectedVersion}.`,
  );
  process.exit(0);
}

const workflowVersion = match[1];

if (workflowVersion !== expectedVersion) {
  console.error(
    `[playwright-version-sync] Version mismatch: package-lock.json locks @playwright/test to ${expectedVersion} (package.json range ${packageRangeRaw}), workflow container uses ${workflowVersion}.`,
  );
  process.exit(1);
}

console.log(
  `[playwright-version-sync] OK: package-lock.json locks @playwright/test to ${expectedVersion}, matching the CI workflow image (package.json range ${packageRangeRaw}).`,
);

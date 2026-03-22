import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFilePath);
const repoRoot = resolve(scriptDir, '..');
const packageJsonPath = resolve(repoRoot, 'package.json');
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

const packageVersionRaw = packageJson?.devDependencies?.['@playwright/test'];
if (typeof packageVersionRaw !== 'string' || packageVersionRaw.trim().length === 0) {
  console.error('[playwright-version-sync] package.json is missing devDependencies["@playwright/test"].');
  process.exit(1);
}

const expectedVersion = normalizePlaywrightVersion(packageVersionRaw);
if (!expectedVersion) {
  console.error(
    `[playwright-version-sync] Could not normalize @playwright/test version from ${packageVersionRaw}.`,
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

const containerTagPattern = /mcr\.microsoft\.com\/playwright:v([0-9]+\.[0-9]+\.[0-9]+)(?:-[^\s'"]+)?/;
const match = workflowRaw.match(containerTagPattern);

if (!match) {
  console.error(
    '[playwright-version-sync] Could not find a Playwright container image tag in .github/workflows/ci.yml.',
  );
  process.exit(1);
}

const workflowVersion = match[1];

if (workflowVersion !== expectedVersion) {
  console.error(
    `[playwright-version-sync] Version mismatch: package.json has ${expectedVersion}, workflow container uses ${workflowVersion}.`,
  );
  process.exit(1);
}

console.log(
  `[playwright-version-sync] OK: package.json and CI workflow both use Playwright ${expectedVersion}.`,
);

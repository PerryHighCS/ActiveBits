import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFilePath);
const repoRoot = resolve(scriptDir, '..');
const nvmrcPath = resolve(repoRoot, '.nvmrc');

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

function normalizeNodeVersion(value) {
  return String(value).trim().replace(/^v/i, '');
}

let nvmrcRaw;
try {
  nvmrcRaw = readFileSync(nvmrcPath, 'utf8');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[node-version-sync] Unable to read .nvmrc at ${nvmrcPath}: ${message}`);
  process.exit(1);
}
const nvmrcVersion = normalizeNodeVersion(nvmrcRaw);

if (!nvmrcVersion) {
  console.error('[node-version-sync] .nvmrc is empty.');
  process.exit(1);
}

const expectedRange = `>=${nvmrcVersion}`;
const manifestPaths = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'activities/package.json',
];

const mismatches = [];

for (const manifestPath of manifestPaths) {
  const fullPath = resolve(repoRoot, manifestPath);
  let manifest;
  try {
    manifest = readJson(fullPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[node-version-sync] ${message}`);
    process.exit(1);
  }
  const actual = manifest?.engines?.node;

  if (actual !== expectedRange) {
    mismatches.push({ manifestPath, actual });
  }
}

if (mismatches.length > 0) {
  console.error(`[node-version-sync] Expected engines.node to equal ${expectedRange} in all manifests.`);
  for (const mismatch of mismatches) {
    const actualLabel = mismatch.actual === undefined ? '(missing)' : mismatch.actual;
    console.error(`[node-version-sync] ${mismatch.manifestPath}: ${actualLabel}`);
  }
  process.exit(1);
}

console.log(`[node-version-sync] OK: engines.node matches ${expectedRange} in all manifests.`);

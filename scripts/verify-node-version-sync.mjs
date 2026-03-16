import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const nvmrcPath = resolve(repoRoot, '.nvmrc');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeNodeVersion(value) {
  return String(value).trim().replace(/^v/i, '');
}

const nvmrcRaw = readFileSync(nvmrcPath, 'utf8');
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
  const manifest = readJson(fullPath);
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

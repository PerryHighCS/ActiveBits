import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(scriptsDir)
const activitiesDir = join(repositoryRoot, 'activities')
const eslintBin = join(repositoryRoot, 'node_modules', 'eslint', 'bin', 'eslint.js')
const extraArgs = process.argv.slice(2)

const targets = readdirSync(activitiesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right))

if (targets.length === 0) {
  console.log('No activity directories found to lint.')
  process.exit(0)
}

for (const target of targets) {
  console.log(`Linting activities/${target}`)
  const result = spawnSync(process.execPath, [eslintBin, ...extraArgs, target], {
    cwd: activitiesDir,
    stdio: 'inherit',
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

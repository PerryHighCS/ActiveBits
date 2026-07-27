import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const typecheckActivitiesRunnerPath = fileURLToPath(import.meta.url)
const scriptsDir = dirname(typecheckActivitiesRunnerPath)
const repositoryRoot = dirname(scriptsDir)
const activitiesDir = join(repositoryRoot, 'activities')
const activitiesTsconfigPath = join(activitiesDir, 'tsconfig.json')

export function getActivityTargets(directoryEntries) {
  return directoryEntries
    .filter((entry) => (
      entry.isDirectory()
      && !entry.name.startsWith('.')
      && entry.name !== 'node_modules'
      && entry.name !== 'shared'
    ))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

export function buildActivityTypecheckConfig(
  activityName,
  parseConfig = ts.getParsedCommandLineOfConfigFile,
) {
  const config = parseConfig(activitiesTsconfigPath, {}, ts.sys)
  if (!config) {
    return {
      errors: [ts.createCompilerDiagnostic(ts.Diagnostics.Cannot_read_file_0, activitiesTsconfigPath)],
    }
  }

  const includedDirectoryPrefixes = [
    join(activitiesDir, activityName),
    join(activitiesDir, 'shared'),
    join(repositoryRoot, 'types'),
  ].map((directory) => `${directory}${sep}`)

  return {
    ...config,
    fileNames: config.fileNames.filter((fileName) => (
      includedDirectoryPrefixes.some((directoryPrefix) => fileName.startsWith(directoryPrefix))
    )),
  }
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repositoryRoot,
    getNewLine: () => '\n',
  })
}

export function typecheckActivity(activityName) {
  const parsedConfig = buildActivityTypecheckConfig(activityName)
  if (parsedConfig.errors?.length) {
    console.error(formatDiagnostics(parsedConfig.errors))
    return false
  }

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
    projectReferences: parsedConfig.projectReferences,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length === 0) {
    return true
  }

  console.error(formatDiagnostics(diagnostics))
  return false
}

export function runActivityTypecheckProcess(activityName, spawn = spawnSync, reportError = console.error) {
  const result = spawn(process.execPath, [typecheckActivitiesRunnerPath, activityName], { stdio: 'inherit' })
  if (result.error) {
    reportError(`Unable to typecheck activities/${activityName}: ${result.error.message}`)
    return false
  }

  if (result.status === 0) {
    return true
  }

  if (result.signal) {
    reportError(`Typechecking activities/${activityName} ended with signal ${result.signal}.`)
  } else {
    reportError(`Typechecking activities/${activityName} exited with status ${result.status ?? 'unknown'}.`)
  }
  return false
}

export function runActivityTypechecks({
  directoryEntries = readdirSync(activitiesDir, { withFileTypes: true }),
  runTarget = (target) => typecheckActivity(target),
} = {}) {
  const targets = getActivityTargets(directoryEntries)
  if (targets.length === 0) {
    console.log('No activity directories found to typecheck.')
    return true
  }

  let succeeded = true
  for (const target of targets) {
    console.log(`Typechecking activities/${target}`)
    succeeded = runTarget(target) && succeeded
  }
  return succeeded
}

if (process.argv[1] && typecheckActivitiesRunnerPath === process.argv[1]) {
  const activityName = process.argv[2]
  if (activityName) {
    process.exitCode = typecheckActivity(activityName) ? 0 : 1
  } else {
    process.exitCode = runActivityTypechecks({
      runTarget: runActivityTypecheckProcess,
    }) ? 0 : 1
  }
}

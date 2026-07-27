import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(scriptsDir)
const activitiesDir = join(repositoryRoot, 'activities')
const activitiesTsconfigPath = join(activitiesDir, 'tsconfig.json')

export function getActivityTargets(directoryEntries) {
  return directoryEntries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

export function buildActivityTypecheckConfig(activityName) {
  const readResult = ts.readConfigFile(activitiesTsconfigPath, ts.sys.readFile)
  if (readResult.error) {
    return { errors: [readResult.error] }
  }

  const config = {
    ...readResult.config,
    include: [
      `${activityName}/client/**/*`,
      `${activityName}/server/**/*`,
      `${activityName}/shared/**/*`,
      `${activityName}/playwright/**/*`,
      `${activityName}/activity.config.*`,
      'shared/**/*',
      '../types/**/*.d.ts',
    ],
  }

  return ts.parseJsonConfigFileContent(config, ts.sys, activitiesDir, undefined, activitiesTsconfigPath)
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

export function runActivityTypecheckProcess(activityName, spawn = spawnSync) {
  const result = spawn(process.execPath, [process.argv[1], activityName], { stdio: 'inherit' })
  if (result.error) {
    console.error(`Unable to typecheck activities/${activityName}: ${result.error.message}`)
    return false
  }

  if (result.status === 0) {
    return true
  }

  if (result.signal) {
    console.error(`Typechecking activities/${activityName} ended with signal ${result.signal}.`)
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

  return targets.every((target) => {
    console.log(`Typechecking activities/${target}`)
    return runTarget(target)
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const activityName = process.argv[2]
  if (activityName) {
    process.exitCode = typecheckActivity(activityName) ? 0 : 1
  } else {
    process.exitCode = runActivityTypechecks({
      runTarget: runActivityTypecheckProcess,
    }) ? 0 : 1
  }
}

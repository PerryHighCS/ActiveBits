import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildActivityTypecheckConfig,
  getActivityTargets,
  runActivityTypecheckProcess,
  runActivityTypechecks,
} from './typecheck-activities.mjs'

void test('activity typecheck runner uses sorted activity directories', () => {
  assert.deepEqual(getActivityTargets([
    { name: 'syncdeck', isDirectory: () => true },
    { name: '.cache', isDirectory: () => true },
    { name: 'node_modules', isDirectory: () => true },
    { name: 'resonance', isDirectory: () => true },
    { name: 'README.md', isDirectory: () => false },
  ]), ['resonance', 'syncdeck'])
})

void test('activity typecheck config scopes sources to one activity while retaining shared contracts', () => {
  const config = buildActivityTypecheckConfig('syncdeck')
  assert.deepEqual(config.errors, [])
  assert.ok(config.fileNames.some((fileName) => fileName.includes('/activities/syncdeck/')))
  assert.ok(config.fileNames.some((fileName) => fileName.includes('/activities/shared/')))
  assert.equal(config.fileNames.some((fileName) => fileName.includes('/activities/resonance/')), false)
  assert.equal(config.options.strict, true)
  assert.equal(config.options.noUnusedLocals, true)
})

void test('activity typecheck runner invokes each activity independently', () => {
  const checkedTargets = []
  const success = runActivityTypechecks({
    directoryEntries: [
      { name: 'syncdeck', isDirectory: () => true },
      { name: 'resonance', isDirectory: () => true },
    ],
    runTarget: (target) => {
      checkedTargets.push(target)
      return true
    },
  })

  assert.equal(success, true)
  assert.deepEqual(checkedTargets, ['resonance', 'syncdeck'])
})

void test('activity typecheck runner reports a subprocess spawn failure', () => {
  console.info('[TEST] Expected activity typecheck subprocess spawn failure.')
  assert.equal(
    runActivityTypecheckProcess('syncdeck', () => ({ error: new Error('permission denied') })),
    false,
  )
})

void test('activity typecheck runner spawns this runner module for each activity', () => {
  let spawnedArguments
  assert.equal(
    runActivityTypecheckProcess('syncdeck', (...arguments_) => {
      spawnedArguments = arguments_
      return { status: 0 }
    }),
    true,
  )
  assert.equal(spawnedArguments[0], process.execPath)
  assert.match(spawnedArguments[1][0], /scripts\/typecheck-activities\.mjs$/)
  assert.equal(spawnedArguments[1][1], 'syncdeck')
})

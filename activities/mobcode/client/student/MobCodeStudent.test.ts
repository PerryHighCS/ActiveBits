import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyStudentFileContentUpdate,
  cancelPendingStudentWorkspacePersist,
  getStudentRunnerOptions,
  isEmbeddedMobCodeChildSession,
  removeMobCodeSoloTokenFromHash,
  removeMobCodeSoloTokenFromSearch,
  resolveMobCodeStudentRoute,
  resolveStudentActiveFileChange,
  sanitizeStudentPresenceUpdate,
  shouldAutoSelectMyCodeOnTryItStart,
  shouldSelectInstructorFromBroadcastSettings,
  shouldSelectMyCodeFromTryItSettings,
} from './MobCodeStudent'
import type { MobCodeRunnerId } from '../../shared/types'
import type { MobCodeRunnerDefinition } from '../runner/runnerUtils'

void test('applyStudentFileContentUpdate ignores updates for missing paths', () => {
  const files = {
    'Main.java': 'class Main {}',
  }

  assert.equal(applyStudentFileContentUpdate(files, 'Missing.java', 'oops'), files)
  assert.deepEqual(applyStudentFileContentUpdate(files, 'Main.java', 'updated'), {
    'Main.java': 'updated',
  })
})

void test('resolveMobCodeStudentRoute selects the token-authenticated solo manager route only when present', () => {
  assert.deepEqual(resolveMobCodeStudentRoute('', undefined, '#mobcodeSoloToken=opaque-token'), {
    mode: 'solo',
    soloEditToken: 'opaque-token',
  })
  assert.deepEqual(resolveMobCodeStudentRoute('?other=value'), { mode: 'live' })
  assert.deepEqual(resolveMobCodeStudentRoute('?mobcodeSoloToken=opaque-token'), { mode: 'live' })
  assert.deepEqual(resolveMobCodeStudentRoute('?mobcodeSoloToken=%20%20'), { mode: 'live' })
  assert.deepEqual(resolveMobCodeStudentRoute('', { mobcodeSoloToken: ' history-token ' }), {
    mode: 'solo',
    soloEditToken: 'history-token',
  })
  assert.equal(removeMobCodeSoloTokenFromSearch('?mobcodeSoloToken=opaque-token&view=solo'), '?view=solo')
  assert.equal(removeMobCodeSoloTokenFromHash('#mobcodeSoloToken=opaque-token&view=solo'), '#view=solo')
})

void test('isEmbeddedMobCodeChildSession only waits for SyncDeck child sessions', () => {
  assert.equal(isEmbeddedMobCodeChildSession('CHILD:af94a:32728:mobcode'), true)
  assert.equal(isEmbeddedMobCodeChildSession('mobcode-session'), false)
})

void test('shouldAutoSelectMyCodeOnTryItStart only switches views when editing begins with a workspace', () => {
  assert.equal(shouldAutoSelectMyCodeOnTryItStart(false, true, true), true)
  assert.equal(shouldAutoSelectMyCodeOnTryItStart(true, true, true), false)
  assert.equal(shouldAutoSelectMyCodeOnTryItStart(false, true, false), false)
  assert.equal(shouldAutoSelectMyCodeOnTryItStart(true, false, true), false)
})

void test('shouldSelectMyCodeFromTryItSettings switches immediately when Try it is enabled', () => {
  assert.equal(shouldSelectMyCodeFromTryItSettings(false, true), true)
  assert.equal(shouldSelectMyCodeFromTryItSettings(true, true), false)
  assert.equal(shouldSelectMyCodeFromTryItSettings(false, false), false)
})

void test('Try it selection takes priority over the Broadcast workspace selection', () => {
  assert.equal(shouldSelectInstructorFromBroadcastSettings(true, false, true), false)
  assert.equal(shouldSelectInstructorFromBroadcastSettings(false, false, true), true)
  assert.equal(shouldSelectInstructorFromBroadcastSettings(false, true, true), false)
})

void test('reset cancels a delayed pre-reset workspace save and waits for the active save', async () => {
  let delayedSaveFlushed = false
  const debounceRef = {
    current: setTimeout(() => { delayedSaveFlushed = true }, 0) as ReturnType<typeof setTimeout> | null,
  }
  const pendingWorkspaceRef = { current: { files: { 'main.py': 'pre-reset edit' }, activeFile: 'main.py' } as unknown }
  let finishActiveSave!: () => void
  let activeSaveFinished = false
  const inFlightPersistRef = {
    current: new Promise<void>((resolve) => { finishActiveSave = resolve }).then(() => { activeSaveFinished = true }),
  }
  let resetRequestStarted = false
  const reset = cancelPendingStudentWorkspacePersist(debounceRef, pendingWorkspaceRef, inFlightPersistRef).then(() => {
    assert.equal(activeSaveFinished, true)
    resetRequestStarted = true
  })

  assert.equal(resetRequestStarted, false)
  finishActiveSave()
  await reset
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.equal(resetRequestStarted, true)
  assert.equal(delayedSaveFlushed, false)
  assert.equal(pendingWorkspaceRef.current, null)
})

void test('resolveStudentActiveFileChange ignores missing active-file updates', () => {
  const files = {
    'Main.java': 'class Main {}',
    'Helper.java': 'class Helper {}',
  }

  assert.equal(resolveStudentActiveFileChange(files, 'Main.java', 'Helper.java'), 'Helper.java')
  assert.equal(resolveStudentActiveFileChange(files, 'Main.java', 'Missing.java'), 'Main.java')
  assert.equal(resolveStudentActiveFileChange(files, 'Main.java', null), 'Main.java')
})

void test('sanitizeStudentPresenceUpdate rejects missing files and out-of-bounds selections', () => {
  const files = {
    'Main.java': 'class Main {}',
  }

  assert.equal(
    sanitizeStudentPresenceUpdate(files, {
      path: 'Missing.java',
      selections: [{ anchor: 0, head: 0 }],
    }),
    null,
  )

  assert.equal(
    sanitizeStudentPresenceUpdate(files, {
      path: 'Main.java',
      selections: [{ anchor: 0, head: 500 }],
    }),
    null,
  )
})

void test('sanitizeStudentPresenceUpdate keeps in-bounds selections', () => {
  const files = {
    'Main.java': 'class Main {}',
  }

  assert.deepEqual(
    sanitizeStudentPresenceUpdate(files, {
      path: 'Main.java',
      selections: [{ anchor: 1, head: 5 }],
    }),
    {
      path: 'Main.java',
      selections: [{ anchor: 1, head: 5 }],
    },
  )
})

void test('getStudentRunnerOptions exposes only the instructor-selected runner', () => {
  const pythonRunner: MobCodeRunnerDefinition = {
    id: 'brython-terminal',
    label: 'Python Terminal',
    description: 'Run Python',
  }
  const futureRunner: MobCodeRunnerDefinition = {
    id: 'future-runner' as MobCodeRunnerId,
    label: 'Future Runner',
    description: 'Not here yet',
  }

  assert.deepEqual(getStudentRunnerOptions('brython-terminal', [pythonRunner, futureRunner]), [pythonRunner])
  assert.deepEqual(getStudentRunnerOptions('missing-runner' as MobCodeRunnerId, [pythonRunner]), [{
    id: 'missing-runner' as MobCodeRunnerId,
    label: 'Unavailable runner',
    description: 'The instructor-selected runner is not available in this browser.',
  }])
})

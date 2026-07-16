import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyStudentFileContentUpdate,
  getStudentRunnerOptions,
  removeMobCodeSoloTokenFromSearch,
  resolveMobCodeStudentRoute,
  resolveStudentActiveFileChange,
  sanitizeStudentPresenceUpdate,
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
  assert.deepEqual(resolveMobCodeStudentRoute('?mobcodeSoloToken=opaque-token'), {
    mode: 'solo',
    soloEditToken: 'opaque-token',
  })
  assert.deepEqual(resolveMobCodeStudentRoute('?other=value'), { mode: 'live' })
  assert.deepEqual(resolveMobCodeStudentRoute('?mobcodeSoloToken=%20%20'), { mode: 'live' })
  assert.deepEqual(resolveMobCodeStudentRoute('', { mobcodeSoloToken: ' history-token ' }), {
    mode: 'solo',
    soloEditToken: 'history-token',
  })
  assert.equal(removeMobCodeSoloTokenFromSearch('?mobcodeSoloToken=opaque-token&view=solo'), '?view=solo')
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

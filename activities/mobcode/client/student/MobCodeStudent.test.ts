import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyStudentFileContentUpdate,
  resolveStudentActiveFileChange,
  sanitizeStudentPresenceUpdate,
} from './MobCodeStudent'

void test('applyStudentFileContentUpdate ignores updates for missing paths', () => {
  const files = {
    'Main.java': 'class Main {}',
  }

  assert.equal(applyStudentFileContentUpdate(files, 'Missing.java', 'oops'), files)
  assert.deepEqual(applyStudentFileContentUpdate(files, 'Main.java', 'updated'), {
    'Main.java': 'updated',
  })
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

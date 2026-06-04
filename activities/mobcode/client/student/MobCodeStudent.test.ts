import assert from 'node:assert/strict'
import test from 'node:test'
import { applyStudentFileContentUpdate, resolveStudentActiveFileChange } from './MobCodeStudent'

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

import assert from 'node:assert/strict'
import test from 'node:test'
import { applyActiveFileChange, applyContentChange, createStateSnapshot } from './managerUtils'

void test('applyContentChange updates files while preserving the active file snapshot', () => {
  const current = createStateSnapshot({ 'Main.java': 'old' }, 'Main.java')
  assert.deepEqual(applyContentChange(current, 'Main.java', 'new'), {
    files: { 'Main.java': 'new' },
    activeFile: 'Main.java',
  })
})

void test('applyActiveFileChange updates only the active file in the snapshot', () => {
  const current = createStateSnapshot({ 'Main.java': 'class Main {}' }, 'Main.java')
  assert.deepEqual(applyActiveFileChange(current, 'Helper.java'), {
    files: { 'Main.java': 'class Main {}' },
    activeFile: 'Helper.java',
  })
})

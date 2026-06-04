import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deletePathFromFiles,
  getFileExtension,
  isValidFileName,
  isValidMobCodePath,
  normalizeMobCodePath,
  renamePathInFiles,
  resolveActiveFile,
  sanitizeFilesMap,
} from './fileUtils'

void test('path helpers normalize and validate file names', () => {
  assert.equal(normalizeMobCodePath('/src//Main.java'), 'src/Main.java')
  assert.equal(isValidFileName('Main.java'), true)
  assert.equal(isValidFileName('../Main.java'), false)
  assert.equal(isValidFileName('src/Main.java'), false)
  assert.equal(isValidFileName(''), false)
  assert.equal(isValidFileName('bad\0name'), false)
  assert.equal(getFileExtension('src/Main.java'), 'java')
})

void test('isValidMobCodePath accepts safe relative paths and rejects traversal', () => {
  assert.equal(isValidMobCodePath('src/Main.java'), true)
  assert.equal(isValidMobCodePath('folder/.keep'), true)
  assert.equal(isValidMobCodePath('../Main.java'), false)
  assert.equal(isValidMobCodePath('src/../Main.java'), false)
})

void test('sanitizeFilesMap keeps safe string files and trims invalid entries', () => {
  assert.deepEqual(sanitizeFilesMap({ 'Main.java': 'class Main {}', '../bad': 'x', image: 4 }), {
    'Main.java': 'class Main {}',
  })
})

void test('rename and delete path helpers handle files and folders', () => {
  const files = { 'src/Main.java': 'a', 'src/Helper.java': 'b', 'README.md': 'c' }
  assert.deepEqual(renamePathInFiles(files, 'src', 'app'), {
    'app/Main.java': 'a',
    'app/Helper.java': 'b',
    'README.md': 'c',
  })
  assert.deepEqual(deletePathFromFiles(files, 'src'), { 'README.md': 'c' })
  assert.equal(resolveActiveFile(files, 'missing'), 'README.md')
})

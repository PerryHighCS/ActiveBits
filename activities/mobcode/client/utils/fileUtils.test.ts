import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampMobCodeContentEdit,
  deletePathFromFiles,
  getFileExtension,
  isValidFileName,
  isValidMobCodePath,
  normalizeMobCodePath,
  renameActiveFilePath,
  renamePathInFiles,
  resolveActiveFile,
  sanitizeFilesMap,
  wouldPathConflict,
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

void test('sanitizeFilesMap drops file entries that collide with implied folder paths', () => {
  assert.deepEqual(sanitizeFilesMap({
    src: 'hidden',
    'src/Main.java': 'class Main {}',
    'src/utils/math.ts': 'export const math = 1',
  }), {
    'src/Main.java': 'class Main {}',
    'src/utils/math.ts': 'export const math = 1',
  })
})

void test('sanitizeFilesMap enforces file-count and total-size limits', () => {
  const tooMany = Object.fromEntries(Array.from({ length: 260 }, (_, index) => [`src/File${index}.txt`, 'x']))
  assert.equal(Object.keys(sanitizeFilesMap(tooMany)).length, 250)

  const oversized = sanitizeFilesMap(Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [`src/File${index}.txt`, 'x'.repeat(1024 * 1024)]),
  ))
  assert.deepEqual(Object.keys(oversized), ['src/File0.txt', 'src/File1.txt', 'src/File2.txt', 'src/File3.txt'])
})

void test('sanitizeFilesMap measures UTF-8 bytes for per-file and total-size limits', () => {
  const oversizedSingle = sanitizeFilesMap({
    'Emoji.txt': '😀'.repeat(300_000),
  })
  assert.equal(new TextEncoder().encode(oversizedSingle['Emoji.txt'] ?? '').byteLength <= 1_000_000, true)

  const oversizedTotal = sanitizeFilesMap(Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [`src/File${index}.txt`, '😀'.repeat(300_000)]),
  ))
  assert.deepEqual(Object.keys(oversizedTotal), ['src/File0.txt', 'src/File1.txt', 'src/File2.txt', 'src/File3.txt'])
})

void test('clampMobCodeContentEdit enforces per-file and total workspace limits for live edits', () => {
  const perFileEdit = clampMobCodeContentEdit({}, 'Emoji.txt', '😀'.repeat(300_000))
  assert.equal(new TextEncoder().encode(perFileEdit.content).byteLength <= 1_000_000, true)
  assert.equal(perFileEdit.limitReason, 'per-file')

  const crowdedFiles = Object.fromEntries(
    Array.from({ length: 4 }, (_, index) => [`src/File${index}.txt`, '😀'.repeat(300_000)]),
  )
  const totalEdit = clampMobCodeContentEdit(crowdedFiles, 'src/File0.txt', '😀'.repeat(400_000))
  assert.equal(new TextEncoder().encode(totalEdit.content).byteLength, 594_304)
  assert.equal(totalEdit.limitReason, 'total')
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
  assert.equal(renameActiveFilePath('src/Main.java', 'src', 'app'), 'app/Main.java')
  assert.equal(renameActiveFilePath('src', 'src', 'app'), 'app')
  assert.equal(renameActiveFilePath('README.md', 'src', 'app'), 'README.md')
  assert.deepEqual(renamePathInFiles(files, 'src/Main.java', 'README.md'), files)
  assert.deepEqual(renamePathInFiles(files, 'src', 'README.md'), files)
})

void test('wouldPathConflict catches file and folder creation collisions', () => {
  const files = {
    'src/Main.java': 'a',
    'README.md': 'b',
    'empty/.keep': '',
  }

  assert.equal(wouldPathConflict(files, 'README.md'), true)
  assert.equal(wouldPathConflict(files, 'src'), true)
  assert.equal(wouldPathConflict(files, 'src/Main.java'), true)
  assert.equal(wouldPathConflict(files, 'empty'), true)
  assert.equal(wouldPathConflict(files, 'notes/Todo.md'), false)
})

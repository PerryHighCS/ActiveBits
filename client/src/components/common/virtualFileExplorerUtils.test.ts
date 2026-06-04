import assert from 'node:assert/strict'
import test from 'node:test'
import { buildVirtualFileTree, isSafeVirtualPath, normalizeVirtualPath } from './virtualFileExplorerUtils'

void test('buildVirtualFileTree derives sorted folders and files from a flat map', () => {
  const tree = buildVirtualFileTree({
    'src/App.tsx': '',
    'README.md': '',
    'src/utils/math.ts': '',
    'src/index.ts': '',
  })

  assert.deepEqual(
    tree.map((entry) => `${entry.kind}:${entry.path}`),
    ['folder:src', 'file:README.md'],
  )
  assert.deepEqual(
    tree[0]?.children?.map((entry) => `${entry.kind}:${entry.path}`),
    ['folder:src/utils', 'file:src/App.tsx', 'file:src/index.ts'],
  )
})

void test('buildVirtualFileTree filters unsafe or invalid file paths', () => {
  const tree = buildVirtualFileTree({
    'src/App.tsx': '',
    '../bad.ts': '',
    'bad\0name.ts': '',
    '': '',
  })

  assert.deepEqual(
    tree.map((entry) => `${entry.kind}:${entry.path}`),
    ['folder:src'],
  )
})

void test('normalizeVirtualPath trims slashes and ignores empty segments', () => {
  assert.equal(normalizeVirtualPath('/src//Main.java'), 'src/Main.java')
  assert.equal(normalizeVirtualPath('src\\Main.java'), 'src/Main.java')
})

void test('isSafeVirtualPath rejects traversal, empty, null byte, and long paths', () => {
  assert.equal(isSafeVirtualPath('src/Main.java'), true)
  assert.equal(isSafeVirtualPath('../Main.java'), false)
  assert.equal(isSafeVirtualPath(''), false)
  assert.equal(isSafeVirtualPath('bad\0name'), false)
  assert.equal(isSafeVirtualPath(`${'a'.repeat(241)}.txt`), false)
})

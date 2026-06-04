import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeMobCodeSessionData } from './routes'

void test('normalizeMobCodeSessionData creates default group when missing', () => {
  const data = normalizeMobCodeSessionData({})
  assert.deepEqual(data.groups.default, { files: {}, activeFile: '' })
})

void test('normalizeMobCodeSessionData preserves valid files and active file', () => {
  const data = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: { 'Main.java': 'class Main {}' },
        activeFile: 'Main.java',
      },
    },
  })
  assert.deepEqual(data.groups.default, {
    files: { 'Main.java': 'class Main {}' },
    activeFile: 'Main.java',
  })
})

void test('normalizeMobCodeSessionData drops invalid file records and repairs active file', () => {
  const data = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: { '../bad': 'x', 'src/Main.java': 'ok', binary: 7 },
        activeFile: '../bad',
      },
    },
  })
  assert.deepEqual(data.groups.default, {
    files: { 'src/Main.java': 'ok' },
    activeFile: 'src/Main.java',
  })
})

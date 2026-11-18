import test from 'node:test'
import assert from 'node:assert/strict'
import { focusRestoreTarget } from './useRestoreFocusAfterRemoval.js'

const cases: [string, Parameters<typeof focusRestoreTarget>[0], ReturnType<typeof focusRestoreTarget>][] = [
  ['control removed, focus lost → stable target', { originConnected: false, focusLost: true, requestFailed: false }, 'target'],
  ['control removed, but the user focused something else → leave it', { originConnected: false, focusLost: false, requestFailed: false }, null],
  ['still there and pending (disabled while busy) → wait', { originConnected: true, focusLost: true, requestFailed: false }, null],
  ['request failed, control still there, focus lost → back to it', { originConnected: true, focusLost: true, requestFailed: true }, 'origin'],
  ['request failed but the user moved on → leave it', { originConnected: true, focusLost: false, requestFailed: true }, null],
  ['control removed although the response failed (change landed by snapshot) → target', { originConnected: false, focusLost: true, requestFailed: true }, 'target'],
]

for (const [name, state, expected] of cases) {
  void test(`focusRestoreTarget: ${name}`, () => {
    assert.equal(focusRestoreTarget(state), expected)
  })
}

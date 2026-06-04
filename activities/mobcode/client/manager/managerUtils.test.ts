import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyActiveFileChange,
  applyContentChange,
  createEditorPresencePayload,
  createLiveContentSyncPlan,
  createStateSnapshot,
} from './managerUtils'

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

void test('createLiveContentSyncPlan sends immediately on first sync or after the throttle window', () => {
  assert.deepEqual(createLiveContentSyncPlan(1_000, 0, 120), {
    sendImmediately: true,
    delayMs: 0,
  })
  assert.deepEqual(createLiveContentSyncPlan(1_000, 800, 120), {
    sendImmediately: true,
    delayMs: 0,
  })
})

void test('createLiveContentSyncPlan throttles live syncs while typing continuously', () => {
  assert.deepEqual(createLiveContentSyncPlan(1_000, 950, 120), {
    sendImmediately: false,
    delayMs: 70,
  })
})

void test('createEditorPresencePayload clones selection ranges for websocket presence updates', () => {
  const payload = createEditorPresencePayload('Main.java', [
    { anchor: 2, head: 6 },
    { anchor: 10, head: 10 },
  ])

  assert.deepEqual(payload, {
    path: 'Main.java',
    selections: [
      { anchor: 2, head: 6 },
      { anchor: 10, head: 10 },
    ],
  })
})

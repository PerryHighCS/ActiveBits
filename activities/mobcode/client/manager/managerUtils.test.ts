import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyActiveFileChange,
  applyContentChange,
  createEditorPresencePayload,
  createLiveContentSyncPlan,
  createStateSnapshot,
  flushPendingMobCodeCleanupWork,
  resolveMobCodeHasUnsharedChanges,
  sendMobCodeWsMessage,
  shouldApplyRemoteStateMessage,
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

void test('shouldApplyRemoteStateMessage keeps editable manager state authoritative', () => {
  assert.equal(shouldApplyRemoteStateMessage('state-sync', true), false)
  assert.equal(shouldApplyRemoteStateMessage('file-tree-changed', true), false)
  assert.equal(shouldApplyRemoteStateMessage('state-sync', false), true)
  assert.equal(shouldApplyRemoteStateMessage('file-content-update', true), true)
})

void test('resolveMobCodeHasUnsharedChanges treats any files as unshared before a starter version exists', () => {
  assert.equal(resolveMobCodeHasUnsharedChanges({ 'main.py': 'print(1)' }, null), true)
  assert.equal(resolveMobCodeHasUnsharedChanges({}, null), false)
})

void test('resolveMobCodeHasUnsharedChanges detects content, added, and removed file changes against the starter version', () => {
  const starter = { 'main.py': 'print(1)' }
  assert.equal(resolveMobCodeHasUnsharedChanges({ 'main.py': 'print(1)' }, starter), false)
  assert.equal(resolveMobCodeHasUnsharedChanges({ 'main.py': 'print(2)' }, starter), true)
  assert.equal(resolveMobCodeHasUnsharedChanges({ 'main.py': 'print(1)', 'util.py': '' }, starter), true)
  assert.equal(resolveMobCodeHasUnsharedChanges({ 'util.py': 'print(1)' }, starter), true)
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

void test('flushPendingMobCodeCleanupWork flushes pending content before presence and persists pending state', () => {
  const calls: string[] = []

  flushPendingMobCodeCleanupWork({
    hasPendingContent: true,
    hasPendingPresence: true,
    hasPendingPersist: true,
    flushContent: () => calls.push('content'),
    flushPresence: () => calls.push('presence'),
    flushPersist: () => calls.push('persist'),
  })

  assert.deepEqual(calls, ['content', 'persist'])
})

void test('flushPendingMobCodeCleanupWork flushes presence when there is no pending content', () => {
  const calls: string[] = []

  flushPendingMobCodeCleanupWork({
    hasPendingContent: false,
    hasPendingPresence: true,
    hasPendingPersist: false,
    flushContent: () => calls.push('content'),
    flushPresence: () => calls.push('presence'),
    flushPersist: () => calls.push('persist'),
  })

  assert.deepEqual(calls, ['presence'])
})

void test('sendMobCodeWsMessage returns false when websocket send throws', () => {
  const ws = {
    readyState: 1 as const,
    send() {
      throw new Error('socket closed')
    },
  }

  assert.equal(
    sendMobCodeWsMessage(ws, {
      type: 'file-content-update',
      sessionId: 'abc123',
      payload: { path: 'Main.java', content: 'class Main {}' },
    }),
    false,
  )
})

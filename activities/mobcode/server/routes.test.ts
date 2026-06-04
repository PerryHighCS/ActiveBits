import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeMobCodeSessionData, readDurableMessageType, readStatePayload, readWsRelayMessage } from './routes'

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

void test('readStatePayload rejects malformed requests instead of clearing state', () => {
  assert.equal(readStatePayload(null), null)
  assert.equal(readStatePayload({ activeFile: 'Main.java' }), null)
  assert.equal(readStatePayload({ files: {}, activeFile: 3 }), null)
  assert.deepEqual(readStatePayload({ files: { '../bad': 'x', 'Main.java': 'ok' }, activeFile: '../bad' }), {
    files: { 'Main.java': 'ok' },
    activeFile: 'Main.java',
  })
})

void test('readDurableMessageType only accepts supported persisted broadcast types', () => {
  assert.equal(readDurableMessageType('state-sync'), 'state-sync')
  assert.equal(readDurableMessageType('file-tree-changed'), 'file-tree-changed')
  assert.equal(readDurableMessageType('active-file-changed'), 'state-sync')
  assert.equal(readDurableMessageType({}), 'state-sync')
})

void test('readWsRelayMessage validates websocket mutation payloads against session files', () => {
  const files = { 'src/Main.java': 'class Main {}' }

  assert.deepEqual(
    readWsRelayMessage({ type: 'file-content-update', payload: { path: 'src/Main.java', content: 'updated' } }, files),
    { type: 'file-content-update', payload: { path: 'src/Main.java', content: 'updated' } },
  )
  assert.deepEqual(
    readWsRelayMessage({ type: 'active-file-changed', payload: { activeFile: 'src/Main.java' } }, files),
    { type: 'active-file-changed', payload: { activeFile: 'src/Main.java' } },
  )
  assert.equal(
    readWsRelayMessage({ type: 'file-content-update', payload: { path: '../bad', content: 'x' } }, files),
    null,
  )
  assert.equal(
    readWsRelayMessage({ type: 'file-content-update', payload: { path: 'missing.java', content: 'x' } }, files),
    null,
  )
  assert.equal(
    readWsRelayMessage({ type: 'active-file-changed', payload: { activeFile: 'missing.java' } }, files),
    null,
  )
})

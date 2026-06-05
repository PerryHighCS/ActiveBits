import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyWsRelayMessageToGroupState,
  normalizeMobCodeSessionData,
  readDurableMessageType,
  readStatePayload,
  readWsInstructorPasscode,
  readWsRelayMessage,
} from './routes'

void test('normalizeMobCodeSessionData creates default group when missing', () => {
  const data = normalizeMobCodeSessionData({})
  assert.deepEqual(data.groups.default, { files: {}, activeFile: '' })
  assert.equal(typeof data.instructorPasscode, 'string')
  assert.equal(data.instructorPasscode?.length, 32)
})

void test('normalizeMobCodeSessionData preserves valid files and active file', () => {
  const data = normalizeMobCodeSessionData({
    instructorPasscode: 'secret',
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
  assert.equal(data.instructorPasscode, 'secret')
})

void test('normalizeMobCodeSessionData drops invalid file records and repairs active file', () => {
  const data = normalizeMobCodeSessionData({
    instructorPasscode: 42,
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
  assert.equal(typeof data.instructorPasscode, 'string')
  assert.equal(data.instructorPasscode?.length, 32)
})

void test('normalizeMobCodeSessionData seeds starter files from embedded launch options when groups are missing', () => {
  const data = normalizeMobCodeSessionData({
    embeddedLaunch: {
      selectedOptions: {
        files: {
          'src/Main.java': 'class Main {}',
          '../bad': 'ignored',
        },
        activeFile: 'src/Main.java',
      },
    },
  })

  assert.deepEqual(data.groups.default, {
    files: { 'src/Main.java': 'class Main {}' },
    activeFile: 'src/Main.java',
  })
})

void test('normalizeMobCodeSessionData does not rehydrate embedded starter files when an explicit group already exists', () => {
  const data = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: {},
        activeFile: '',
      },
    },
    embeddedLaunch: {
      selectedOptions: {
        files: {
          'src/Main.java': 'class Main {}',
        },
        activeFile: 'src/Main.java',
      },
    },
  })

  assert.deepEqual(data.groups.default, {
    files: {},
    activeFile: '',
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
  assert.deepEqual(
    readWsRelayMessage(
      {
        type: 'editor-presence-update',
        payload: { path: 'src/Main.java', selections: [{ anchor: 2, head: 5 }] },
      },
      files,
    ),
    { type: 'editor-presence-update', payload: { path: 'src/Main.java', selections: [{ anchor: 2, head: 5 }] } },
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
  assert.equal(
    readWsRelayMessage(
      {
        type: 'editor-presence-update',
        payload: { path: 'src/Main.java', selections: [{ anchor: -1, head: 2 }] },
      },
      files,
    ),
    null,
  )
})

void test('readWsRelayMessage rejects content updates that would exceed total workspace bytes', () => {
  const files = {
    'src/File0.txt': '😀'.repeat(300_000),
    'src/File1.txt': '😀'.repeat(300_000),
    'src/File2.txt': '😀'.repeat(300_000),
    'src/File3.txt': '😀'.repeat(300_000),
  }

  assert.equal(
    readWsRelayMessage(
      {
        type: 'file-content-update',
        payload: { path: 'src/File0.txt', content: '😀'.repeat(400_000) },
      },
      files,
    ),
    null,
  )
})

void test('applyWsRelayMessageToGroupState advances in-memory files for cumulative ws validation', () => {
  const initialGroup = {
    files: {
      'src/File0.txt': 'x'.repeat(1_000_000),
      'src/File1.txt': 'x'.repeat(1_000_000),
      'src/File2.txt': 'x'.repeat(1_000_000),
      'src/File3.txt': 'x'.repeat(700_000),
      'src/File4.txt': 'x'.repeat(400_000),
    },
    activeFile: 'src/File0.txt',
  }

  const acceptedUpdate = readWsRelayMessage(
    {
      type: 'file-content-update',
      payload: { path: 'src/File4.txt', content: 'x'.repeat(450_000) },
    },
    initialGroup.files,
  )
  assert.notEqual(acceptedUpdate, null)

  const updatedGroup = applyWsRelayMessageToGroupState(initialGroup, acceptedUpdate!)
  assert.equal(
    readWsRelayMessage(
      {
        type: 'file-content-update',
        payload: { path: 'src/File3.txt', content: 'x'.repeat(750_000) },
      },
      updatedGroup.files,
    ),
    null,
  )
})

void test('readWsInstructorPasscode accepts only explicit manager auth payloads', () => {
  assert.equal(
    readWsInstructorPasscode({ type: 'manager-auth', payload: { instructorPasscode: 'secret' } }),
    'secret',
  )
  assert.equal(
    readWsInstructorPasscode({ type: 'manager-auth', payload: { instructorPasscode: '' } }),
    null,
  )
  assert.equal(
    readWsInstructorPasscode({ type: 'file-content-update', payload: { instructorPasscode: 'secret' } }),
    null,
  )
  assert.equal(
    readWsInstructorPasscode({ type: 'manager-auth', payload: { instructorPasscode: 'x'.repeat(513) } }),
    null,
  )
})

void test('normalizeMobCodeSessionData verification path rejects oversized passcodes before buffer comparison', () => {
  const data = normalizeMobCodeSessionData({
    instructorPasscode: 'x'.repeat(513),
    groups: { default: { files: {}, activeFile: '' } },
  })
  assert.equal(typeof data.instructorPasscode, 'string')
  assert.equal(data.instructorPasscode?.length, 32)
  assert.notEqual(data.instructorPasscode, 'x'.repeat(513))
})

void test('normalizeMobCodeSessionData enforces UTF-8 byte limits for file content and total size', () => {
  const oversizedSingle = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: {
          'Emoji.txt': '😀'.repeat(300_000),
        },
        activeFile: 'Emoji.txt',
      },
    },
  })
  const singleGroup = oversizedSingle.groups.default!
  assert.equal(Buffer.byteLength(singleGroup.files['Emoji.txt'] ?? '', 'utf8') <= 1_000_000, true)

  const oversizedTotal = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [`src/File${index}.txt`, '😀'.repeat(300_000)]),
        ),
        activeFile: 'src/File0.txt',
      },
    },
  })
  const totalGroup = oversizedTotal.groups.default!
  assert.deepEqual(Object.keys(totalGroup.files), [
    'src/File0.txt',
    'src/File1.txt',
    'src/File2.txt',
    'src/File3.txt',
  ])
})

void test('normalizeMobCodeSessionData drops file entries that collide with implied folder paths', () => {
  const data = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: {
          src: 'hidden',
          'src/Main.java': 'class Main {}',
          'src/utils/math.ts': 'export const math = 1',
        },
        activeFile: 'src',
      },
    },
  })

  assert.deepEqual(data.groups.default, {
    files: {
      'src/Main.java': 'class Main {}',
      'src/utils/math.ts': 'export const math = 1',
    },
    activeFile: 'src/Main.java',
  })
})

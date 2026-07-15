import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWaitingRoomStorageKey,
  getWaitingRoomInitialValues,
  persistRememberedStudentDisplayName,
  persistWaitingRoomValues,
  readRememberedStudentDisplayName,
  REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE,
  REMEMBERED_STUDENT_DISPLAY_NAME_MAX_LENGTH,
  readWaitingRoomValues,
  validateWaitingRoomValues,
  type WaitingRoomStorageLike,
} from './waitingRoomFormUtils'
import type { WaitingRoomFieldConfig } from '../../../../types/waitingRoom.js'

function createStorage(): WaitingRoomStorageLike {
  const store = new Map<string, string>()
  return {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
  }
}

const sampleFields: WaitingRoomFieldConfig[] = [
  {
    id: 'displayName',
    type: 'text',
    label: 'Display name',
    required: true,
  },
  {
    id: 'team',
    type: 'select',
    label: 'Team',
    required: true,
    options: [
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ],
  },
]

void test('buildWaitingRoomStorageKey namespaces by activity and hash', () => {
  assert.equal(buildWaitingRoomStorageKey('gallery-walk', 'abc123'), 'waiting-room:gallery-walk:abc123')
})

void test('remembered student display name round-trips through a one-year, same-site cookie', () => {
  const cookieDocument = { cookie: '' }

  persistRememberedStudentDisplayName(cookieDocument, '  Ada Lovelace  ', { isSecure: true })

  assert.match(cookieDocument.cookie, new RegExp(`^${REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE}=Ada%20Lovelace;`))
  assert.match(cookieDocument.cookie, /Path=\//)
  assert.match(cookieDocument.cookie, /SameSite=Lax/)
  assert.match(cookieDocument.cookie, /Max-Age=31536000/)
  assert.match(cookieDocument.cookie, /Secure/)
  assert.equal(
    readRememberedStudentDisplayName({ cookie: `${cookieDocument.cookie}; unrelated=value` }),
    'Ada Lovelace',
  )
})

void test('remembered student display name ignores malformed cookies and clears blank values', () => {
  assert.equal(
    readRememberedStudentDisplayName({ cookie: `${REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE}=%E0%A4%A` }),
    null,
  )

  const cookieDocument = { cookie: '' }
  persistRememberedStudentDisplayName(cookieDocument, '   ')
  assert.match(cookieDocument.cookie, /Max-Age=0/)
})

void test('remembered student display name is capped before it is stored or read', () => {
  const tooLongName = 'A'.repeat(REMEMBERED_STUDENT_DISPLAY_NAME_MAX_LENGTH + 1)
  const cookieDocument = { cookie: '' }

  persistRememberedStudentDisplayName(cookieDocument, tooLongName)

  assert.equal(readRememberedStudentDisplayName(cookieDocument), 'A'.repeat(REMEMBERED_STUDENT_DISPLAY_NAME_MAX_LENGTH))
})

void test('getWaitingRoomInitialValues applies defaults and sanitizes stored values', () => {
  assert.deepEqual(
    getWaitingRoomInitialValues(sampleFields, { displayName: 'Ada', team: 42 }),
    {
      displayName: 'Ada',
      team: '',
    },
  )
})

void test('validateWaitingRoomValues enforces required fields and select choices', () => {
  assert.deepEqual(
    validateWaitingRoomValues(sampleFields, { displayName: '  ', team: 'green' }),
    {
      displayName: 'Display name is required.',
      team: 'Team has an invalid selection.',
    },
  )

  assert.deepEqual(
    validateWaitingRoomValues(sampleFields, { displayName: 'Ada', team: 'red' }),
    {},
  )
})

void test('persistWaitingRoomValues and readWaitingRoomValues round-trip sanitized values', () => {
  const storage = createStorage()
  const storageKey = buildWaitingRoomStorageKey('syncdeck', 'hash-1')

  persistWaitingRoomValues(storage, storageKey, sampleFields, {
    displayName: 'Grace',
    team: 'blue',
    ignored: 'value',
  })

  assert.deepEqual(readWaitingRoomValues(storage, storageKey, sampleFields), {
    displayName: 'Grace',
    team: 'blue',
  })
})

void test('readWaitingRoomValues drops invalid JSON payloads and warns', () => {
  const storage = createStorage()
  const storageKey = buildWaitingRoomStorageKey('syncdeck', 'hash-2')
  const warnings: string[] = []
  storage.setItem(storageKey, '{bad-json')

  assert.equal(
    readWaitingRoomValues(storage, storageKey, sampleFields, (message) => warnings.push(message)),
    null,
  )
  assert.equal(storage.getItem(storageKey), null)
  assert.match(warnings[0] ?? '', /Failed to parse waiting-room state/)
})

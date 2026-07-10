import assert from 'node:assert/strict'
import test from 'node:test'
import { readInstructorPasscode, reorderPostIds } from './PostboardManager.js'

function withMockWindow(
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>,
  run: () => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage },
  })

  try {
    run()
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'window', descriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
}

void test('reorderPostIds moves the dragged post to the target position', () => {
  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p3', 'p1'),
    ['p3', 'p1', 'p2'],
  )

  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p1', 'p3'),
    ['p2', 'p3', 'p1'],
  )
})

void test('reorderPostIds leaves the order unchanged for no-op or invalid drags', () => {
  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p2', 'p2'),
    ['p1', 'p2', 'p3'],
  )

  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'missing', 'p2'),
    ['p1', 'p2', 'p3'],
  )

  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p1', 'missing'),
    ['p1', 'p2', 'p3'],
  )
})

void test('readInstructorPasscode stores passcode from route state when storage is available', () => {
  const stored = new Map<string, string>()

  withMockWindow({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => {
      stored.set(key, value)
    },
  }, () => {
    assert.equal(
      readInstructorPasscode('session-1', { createSessionPayload: { instructorPasscode: 'teacher-pass' } }),
      'teacher-pass',
    )
  })

  assert.equal(stored.get('postboard_instructor_session-1'), 'teacher-pass')
})

void test('readInstructorPasscode falls back safely when sessionStorage throws', () => {
  withMockWindow({
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }, () => {
    assert.equal(
      readInstructorPasscode('session-2', { instructorPasscode: 'state-pass' }),
      'state-pass',
    )
    assert.equal(readInstructorPasscode('session-2', null), '')
  })
})

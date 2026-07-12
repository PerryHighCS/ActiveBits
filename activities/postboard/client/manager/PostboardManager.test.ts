import assert from 'node:assert/strict'
import test from 'node:test'
import { getInstructorBoardCardClassName, readEmbeddedManagerToken, readInstructorPasscode, reorderPostIds } from './PostboardManager.js'

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

void test('readEmbeddedManagerToken accepts only non-empty SyncDeck iframe tokens', () => {
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=token-123'), 'token-123')
  assert.equal(readEmbeddedManagerToken('?embeddedManagerToken=%20%20'), null)
  assert.equal(readEmbeddedManagerToken(''), null)
})

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

void test('getInstructorBoardCardClassName always reserves space for the flag toggle control', () => {
  // The flag toggle renders in every card corner regardless of flagged state,
  // so the header must always reserve space for it to avoid overlapping the title.
  const unflaggedClassName = getInstructorBoardCardClassName(
    { id: 'post-1', status: 'approved', styleId: 'default' },
  )
  assert.ok(unflaggedClassName.includes('postboard-card-with-flag'))

  const flaggedClassName = getInstructorBoardCardClassName(
    { id: 'post-1', status: 'approved', styleId: 'default' },
  )
  assert.ok(flaggedClassName.includes('postboard-card-with-flag'))
})

void test('getInstructorBoardCardClassName includes faded and drag states', () => {
  const className = getInstructorBoardCardClassName(
    { id: 'post-1', status: 'deleted', styleId: 'default' },
    { isDragging: true, isDragOver: true },
  )

  assert.ok(className.includes('postboard-card-rejected'))
  assert.ok(className.includes('postboard-card-dragging'))
  assert.ok(className.includes('postboard-card-drag-over'))
})

void test('readInstructorPasscode reads passcode from route state without persisting it', () => {
  const stored = new Map<string, string>()
  let writeCount = 0

  withMockWindow({
    getItem: (key) => stored.get(key) ?? null,
    setItem: () => {
      writeCount += 1
    },
  }, () => {
    assert.equal(
      readInstructorPasscode('session-1', { createSessionPayload: { instructorPasscode: 'teacher-pass' } }),
      'teacher-pass',
    )
  })

  assert.equal(writeCount, 0)
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

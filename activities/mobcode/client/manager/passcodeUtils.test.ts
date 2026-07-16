import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMobCodeManagerAuthMessage,
  resolveMobCodeWorkspaceAccess,
  resolveMobCodeManagerAccessBanner,
  resolveOpenMobCodeManagerAuthMessage,
} from './MobCodeManager.js'
import { resolveMobCodeInstructorPasscode } from './passcodeUtils'

function createStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    store,
  }
}

void test('createMobCodeManagerAuthMessage only emits authentication for complete credentials', () => {
  assert.equal(createMobCodeManagerAuthMessage(undefined, 'teacher-pass'), null)
  assert.equal(createMobCodeManagerAuthMessage('session-1', ''), null)
  assert.deepEqual(
    JSON.parse(createMobCodeManagerAuthMessage('session-1', 'teacher-pass') ?? '{}'),
    {
      type: 'manager-auth',
      sessionId: 'session-1',
      payload: { instructorPasscode: 'teacher-pass' },
    },
  )
})

void test('resolveMobCodeWorkspaceAccess grants local solo workspaces edit access without credentials', () => {
  assert.equal(resolveMobCodeWorkspaceAccess({ isSolo: true, instructorPasscode: '' }), true)
  assert.equal(resolveMobCodeWorkspaceAccess({ isSolo: false, instructorPasscode: '' }), false)
  assert.equal(resolveMobCodeWorkspaceAccess({ isSolo: false, instructorPasscode: 'teacher-pass' }), true)
})

void test('resolveMobCodeManagerAccessBanner distinguishes token resolution from missing credentials', () => {
  assert.equal(resolveMobCodeManagerAccessBanner({ instructorPasscode: '', isResolving: true }), 'loading')
  assert.equal(resolveMobCodeManagerAccessBanner({ instructorPasscode: '', isResolving: false }), 'missing')
  assert.equal(resolveMobCodeManagerAccessBanner({ instructorPasscode: 'teacher-pass', isResolving: true }), null)
})

void test('resolveOpenMobCodeManagerAuthMessage authenticates an existing socket after credentials arrive', () => {
  assert.equal(resolveOpenMobCodeManagerAuthMessage({
    sessionId: 'session-1',
    instructorPasscode: 'teacher-pass',
    readyState: 0,
  }), null)
  assert.deepEqual(JSON.parse(resolveOpenMobCodeManagerAuthMessage({
    sessionId: 'session-1',
    instructorPasscode: 'teacher-pass',
    readyState: 1,
  }) ?? '{}'), {
    type: 'manager-auth',
    sessionId: 'session-1',
    payload: { instructorPasscode: 'teacher-pass' },
  })
})

void test('resolveMobCodeInstructorPasscode prefers router state', () => {
  const storage = createStorage()
  assert.equal(
    resolveMobCodeInstructorPasscode({
      sessionId: 's1',
      locationState: { createSessionPayload: { instructorPasscode: 'state-passcode' } },
      storage,
      readBootstrapPayload: () => ({ instructorPasscode: 'bootstrap-passcode' }),
    }),
    'state-passcode',
  )
})

void test('resolveMobCodeInstructorPasscode still accepts legacy direct router state field', () => {
  const storage = createStorage()
  assert.equal(
    resolveMobCodeInstructorPasscode({
      sessionId: 's1',
      locationState: { instructorPasscode: 'state-passcode' },
      storage,
      readBootstrapPayload: () => ({ instructorPasscode: 'bootstrap-passcode' }),
    }),
    'state-passcode',
  )
})

void test('resolveMobCodeInstructorPasscode falls back to activity storage key', () => {
  const storage = createStorage({ mobcode_instructor_s1: 'stored-passcode' })
  assert.equal(
    resolveMobCodeInstructorPasscode({
      sessionId: 's1',
      locationState: null,
      storage,
      readBootstrapPayload: () => null,
    }),
    'stored-passcode',
  )
})

void test('resolveMobCodeInstructorPasscode reads same-tab bootstrap payload without persisting it to storage', () => {
  const storage = createStorage()
  assert.equal(
    resolveMobCodeInstructorPasscode({
      sessionId: 's1',
      locationState: null,
      storage,
      readBootstrapPayload: () => ({ instructorPasscode: 'bootstrap-passcode' }),
    }),
    'bootstrap-passcode',
  )
  assert.equal(storage.store.get('mobcode_instructor_s1'), undefined)
})

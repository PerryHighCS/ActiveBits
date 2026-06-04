import assert from 'node:assert/strict'
import test from 'node:test'
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

void test('resolveMobCodeInstructorPasscode prefers router state', () => {
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

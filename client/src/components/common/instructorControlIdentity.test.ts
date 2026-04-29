import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInstructorControlInstanceId,
  resolveBrowserInstructorControlId,
  resolveOrCreateInstructorControlInstanceId,
  resolveTabInstructorControlId,
  type InstructorControlIdentityStorageLike,
} from './instructorControlIdentity'

function createStorage(): InstructorControlIdentityStorageLike {
  const values = new Map<string, string>()

  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

void test('buildInstructorControlInstanceId joins browser and tab ids', () => {
  assert.equal(buildInstructorControlInstanceId('browser-1', 'tab-1'), 'browser-1:tab-1')
})

void test('resolveOrCreateInstructorControlInstanceId creates and persists browser and tab ids', () => {
  const localStorage = createStorage()
  const sessionStorage = createStorage()
  const createdIds = ['browser-1', 'tab-1']

  const instanceId = resolveOrCreateInstructorControlInstanceId(
    { localStorage, sessionStorage },
    () => createdIds.shift() ?? 'unexpected-id',
  )

  assert.equal(instanceId, 'browser-1:tab-1')
  assert.equal(resolveBrowserInstructorControlId(localStorage), 'browser-1')
  assert.equal(resolveTabInstructorControlId(sessionStorage), 'tab-1')
})

void test('resolveOrCreateInstructorControlInstanceId reuses existing ids on reload', () => {
  const localStorage = createStorage()
  const sessionStorage = createStorage()

  localStorage.setItem('activebits:instructor-control:browser-id', 'browser-1')
  sessionStorage.setItem('activebits:instructor-control:tab-id', 'tab-1')

  let createCalls = 0
  const instanceId = resolveOrCreateInstructorControlInstanceId(
    { localStorage, sessionStorage },
    () => {
      createCalls += 1
      return `generated-${createCalls}`
    },
  )

  assert.equal(instanceId, 'browser-1:tab-1')
  assert.equal(createCalls, 0)
})

void test('resolveOrCreateInstructorControlInstanceId preserves browser identity while creating a new tab id', () => {
  const localStorage = createStorage()
  const sessionStorage = createStorage()

  localStorage.setItem('activebits:instructor-control:browser-id', 'browser-1')

  const instanceId = resolveOrCreateInstructorControlInstanceId(
    { localStorage, sessionStorage },
    () => 'tab-2',
  )

  assert.equal(instanceId, 'browser-1:tab-2')
  assert.equal(resolveBrowserInstructorControlId(localStorage), 'browser-1')
  assert.equal(resolveTabInstructorControlId(sessionStorage), 'tab-2')
})

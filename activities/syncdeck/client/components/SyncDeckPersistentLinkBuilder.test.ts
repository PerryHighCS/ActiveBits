import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSyncDeckPersistentLinkBuilderRequest } from './SyncDeckPersistentLinkBuilder.js'

void test('resolveSyncDeckPersistentLinkBuilderRequest uses shared persistent-session create for new links', () => {
  assert.deepEqual(
    resolveSyncDeckPersistentLinkBuilderRequest({
      activityId: 'syncdeck',
      normalizedTeacherCode: 'teacher-code',
      normalizedPresentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
      editState: null,
    }),
    {
      endpoint: '/api/persistent-session/create',
      body: {
        activityName: 'syncdeck',
        teacherCode: 'teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
        },
      },
    },
  )
})

void test('resolveSyncDeckPersistentLinkBuilderRequest uses persistent-session update for edits', () => {
  assert.deepEqual(
    resolveSyncDeckPersistentLinkBuilderRequest({
      activityId: 'syncdeck',
      normalizedTeacherCode: 'teacher-code',
      normalizedPresentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
      editState: {
        hash: 'hash-123',
        teacherCode: 'teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:5173/presentations/syncdeck-conversion-lab.html',
        },
      },
    }),
    {
      endpoint: '/api/persistent-session/update',
      body: {
        activityName: 'syncdeck',
        hash: 'hash-123',
        teacherCode: 'teacher-code',
        entryPolicy: 'instructor-required',
        selectedOptions: {
          presentationUrl: 'http://localhost:3000/presentations/syncdeck-conversion-lab.html',
        },
      },
    },
  )
})

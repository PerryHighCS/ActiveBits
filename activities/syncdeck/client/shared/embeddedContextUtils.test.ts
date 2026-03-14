import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyncDeckEmbeddedContextApiUrl,
  buildSyncDeckEmbeddedContextRequestBody,
  fetchSyncDeckEmbeddedContext,
} from './embeddedContextUtils.js'

void test('buildSyncDeckEmbeddedContextApiUrl encodes session id', () => {
  assert.equal(
    buildSyncDeckEmbeddedContextApiUrl('session/123'),
    '/api/syncdeck/session%2F123/embedded-context',
  )
})

void test('buildSyncDeckEmbeddedContextRequestBody trims identity fields', () => {
  assert.deepEqual(
    buildSyncDeckEmbeddedContextRequestBody({
      sessionId: 'ignored-by-body',
      instructorPasscode: '  teacher-pass  ',
      studentId: '  student-1  ',
    }),
    {
      instructorPasscode: 'teacher-pass',
      studentId: 'student-1',
    },
  )
})

void test('fetchSyncDeckEmbeddedContext returns parsed role payload on success', async () => {
  const result = await fetchSyncDeckEmbeddedContext(
    {
      sessionId: 'session-1',
      studentId: 'student-1',
    },
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), '/api/syncdeck/session-1/embedded-context')
      assert.equal(init?.method, 'POST')
      assert.equal(init?.credentials, 'include')
      assert.deepEqual(JSON.parse(String(init?.body)), { studentId: 'student-1' })

      return {
        ok: true,
        json: async () => ({
          resolvedRole: 'student',
          studentId: 'student-1',
          studentName: 'Ada Lovelace',
        }),
      } as Response
    }) as typeof fetch,
  )

  assert.deepEqual(result, {
    resolvedRole: 'student',
    studentId: 'student-1',
    studentName: 'Ada Lovelace',
  })
})

void test('fetchSyncDeckEmbeddedContext returns null on forbidden response', async () => {
  const result = await fetchSyncDeckEmbeddedContext(
    {
      sessionId: 'session-1',
      studentId: 'missing-student',
    },
    (async () => ({
      ok: false,
      json: async () => ({ error: 'forbidden' }),
    }) as Response) as typeof fetch,
  )

  assert.equal(result, null)
})

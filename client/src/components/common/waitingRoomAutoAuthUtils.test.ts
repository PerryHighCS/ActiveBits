import assert from 'node:assert/strict'
import test from 'node:test'
import { attemptWaitingRoomAutoTeacherAuth } from './waitingRoomAutoAuthUtils'

void test('attemptWaitingRoomAutoTeacherAuth skips fetch when auto-auth is disabled', async () => {
  let called = false

  await attemptWaitingRoomAutoTeacherAuth({
    shouldAutoAuth: false,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    ws: {
      send() {
        throw new Error('should not send')
      },
    },
    fetchImpl: async () => {
      called = true
      throw new Error('should not fetch')
    },
  })

  assert.equal(called, false)
})

void test('attemptWaitingRoomAutoTeacherAuth sends remembered teacher code over websocket', async () => {
  const sentMessages: string[] = []

  await attemptWaitingRoomAutoTeacherAuth({
    shouldAutoAuth: true,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    ws: {
      send(data) {
        sentMessages.push(data)
      },
    },
    fetchImpl: async (input) => {
      assert.equal(String(input), '/api/persistent-session/hash-1/teacher-code?activityName=java-string-practice')
      return {
        async json() {
          return { teacherCode: ' code-123 ' }
        },
      } as Response
    },
  })

  assert.deepEqual(sentMessages, [
    JSON.stringify({
      type: 'verify-teacher-code',
      teacherCode: 'code-123',
    }),
  ])
})

void test('attemptWaitingRoomAutoTeacherAuth ignores missing remembered teacher code', async () => {
  const sentMessages: string[] = []

  await attemptWaitingRoomAutoTeacherAuth({
    shouldAutoAuth: true,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    ws: {
      send(data) {
        sentMessages.push(data)
      },
    },
    fetchImpl: async () => ({
      async json() {
        return {}
      },
    }) as Response,
  })

  assert.deepEqual(sentMessages, [])
})

void test('attemptWaitingRoomAutoTeacherAuth reports fetch failures without throwing', async () => {
  const warnings: string[] = []

  await attemptWaitingRoomAutoTeacherAuth({
    shouldAutoAuth: true,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    ws: {
      send() {
        throw new Error('should not send')
      },
    },
    fetchImpl: async () => {
      throw new Error('network down')
    },
    onError: (message) => warnings.push(message),
  })

  assert.deepEqual(warnings, ['Failed to fetch teacher code:'])
})

void test('attemptWaitingRoomAutoTeacherAuth reports websocket send failures without throwing', async () => {
  const warnings: string[] = []

  await attemptWaitingRoomAutoTeacherAuth({
    shouldAutoAuth: true,
    hash: 'hash-1',
    activityName: 'java-string-practice',
    ws: {
      send() {
        throw new Error('socket closed')
      },
    },
    fetchImpl: async () => ({
      async json() {
        return { teacherCode: 'code-123' }
      },
    }) as Response,
    onError: (message) => warnings.push(message),
  })

  assert.deepEqual(warnings, ['Failed to send teacher code over WS:'])
})

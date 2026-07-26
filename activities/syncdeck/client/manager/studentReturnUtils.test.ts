import assert from 'node:assert/strict'
import test from 'node:test'
import { requestStudentReturn } from './studentReturnUtils'

const params = { sessionId: 's1', studentId: 'ada', studentName: 'Ada', instructorPasscode: 'code' }
void test('requestStudentReturn does not request when confirmation is cancelled', async () => {
  let called = false
  assert.equal(await requestStudentReturn({ ...params, confirm: () => false, fetchImpl: async () => { called = true; return new Response() } }), 'cancelled')
  assert.equal(called, false)
})
void test('requestStudentReturn reports failed requests and posts the instructor passcode', async () => {
  console.info('[TEST] Expected return-to-waiting-room request failure.')
  let request: RequestInit | undefined
  assert.equal(await requestStudentReturn({ ...params, confirm: () => true, fetchImpl: async (_url, init) => { request = init; return new Response('', { status: 500 }) } }), 'failed')
  assert.match(String(request?.body), /code/)
})
void test('requestStudentReturn reports success for a successful request', async () => {
  assert.equal(await requestStudentReturn({ ...params, confirm: () => true, fetchImpl: async () => new Response('', { status: 200 }) }), 'returned')
})

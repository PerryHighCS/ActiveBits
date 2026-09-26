import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSyncDeckSoloSlideLocation, startSyncDeckSoloChild } from './soloChildLaunch.js'

void test('parseSyncDeckSoloSlideLocation accepts only non-negative integer h:v keys', () => {
  assert.deepEqual(parseSyncDeckSoloSlideLocation('3:1'), { h: 3, v: 1 })
  assert.deepEqual(parseSyncDeckSoloSlideLocation('0:0'), { h: 0, v: 0 })
  assert.equal(parseSyncDeckSoloSlideLocation('3'), null)
  assert.equal(parseSyncDeckSoloSlideLocation('-1:0'), null)
  assert.equal(parseSyncDeckSoloSlideLocation('1.5:0'), null)
  assert.equal(parseSyncDeckSoloSlideLocation('a:b'), null)
  assert.equal(parseSyncDeckSoloSlideLocation(''), null)
})

function createFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const START_PARAMS = {
  sessionId: 'deck 1',
  activityId: 'resonance',
  location: { h: 2, v: 0 },
  selectedOptions: { questions: [] },
  expectedStudentId: 'student-1',
}

void test('startSyncDeckSoloChild posts the slide launch with credentials and returns the handoff', async () => {
  const { calls, fetchImpl } = createFetch(200, {
    childSessionId: 'CHILD:deck 1:abc:resonance',
    entryParticipantToken: 'handoff-token',
    values: { participantId: 'student-1' },
  })

  const result = await startSyncDeckSoloChild({ ...START_PARAMS, fetchImpl })

  assert.deepEqual(result, { childSessionId: 'CHILD:deck 1:abc:resonance', entryParticipantToken: 'handoff-token' })
  assert.equal(calls[0]?.url, '/api/syncdeck/deck%201/solo-activity/start')
  assert.equal(calls[0]?.init?.credentials, 'include')
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    activityId: 'resonance',
    location: { h: 2, v: 0 },
    activityOptions: { questions: [] },
  })
})

void test('startSyncDeckSoloChild rejects denied, malformed, and other-student responses', async () => {
  console.info('[TEST] Expected solo child start failures for denied and invalid responses.')
  await assert.rejects(startSyncDeckSoloChild({ ...START_PARAMS, fetchImpl: createFetch(403, { error: 'forbidden' }).fetchImpl }), /denied \(403\)/)
  await assert.rejects(
    startSyncDeckSoloChild({ ...START_PARAMS, fetchImpl: createFetch(200, { childSessionId: 'c', values: { participantId: 'student-1' } }).fetchImpl }),
    /invalid/,
  )
  await assert.rejects(
    startSyncDeckSoloChild({
      ...START_PARAMS,
      fetchImpl: createFetch(200, { childSessionId: 'c', entryParticipantToken: 't', values: { participantId: 'student-2' } }).fetchImpl,
    }),
    /invalid/,
  )
})

void test('startSyncDeckSoloChild calls fetch without binding it to the params object', async () => {
  const receivers: unknown[] = []
  const fetchImpl = function (this: unknown) {
    // Native fetch rejects any receiver other than the window ("Illegal invocation").
    receivers.push(this)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ childSessionId: 'c', entryParticipantToken: 't', values: { participantId: 'student-1' } }),
    } as Response)
  } as unknown as typeof fetch
  const params = { ...START_PARAMS, fetchImpl }

  await startSyncDeckSoloChild(params)

  assert.equal(receivers.length, 1)
  assert.notEqual(receivers[0], params)
})

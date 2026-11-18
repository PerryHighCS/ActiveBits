import test from 'node:test'
import assert from 'node:assert/strict'
import type { CommissionedIdeasPhase } from '../../shared/types.js'
import {
  clearParticipantToken,
  lateArrivalNotice,
  participantTokenKey,
  readParticipantToken,
  saveParticipantToken,
  type CredentialStorage,
} from './studentIdentity.js'

function memoryStorage(): CredentialStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: (key) => { map.delete(key) },
  }
}

const throwingStorage: CredentialStorage = {
  getItem: () => { throw new Error('[TEST] storage blocked') },
  setItem: () => { throw new Error('[TEST] quota exceeded') },
  removeItem: () => { throw new Error('[TEST] storage blocked') },
}

void test('participant token round-trips per session', () => {
  const storage = memoryStorage()
  assert.equal(saveParticipantToken(storage, 's1', 'tok'), true)
  assert.equal(readParticipantToken(storage, 's1'), 'tok')
  assert.equal(readParticipantToken(storage, 's2'), null, 'another session has its own key')
  clearParticipantToken(storage, 's1')
  assert.equal(storage.map.has(participantTokenKey('s1')), false)
})

void test('storage failures are reported, not thrown', () => {
  assert.equal(saveParticipantToken(throwingStorage, 's1', 'tok'), false)
  assert.equal(readParticipantToken(throwingStorage, 's1'), null)
  assert.doesNotThrow(() => clearParticipantToken(throwingStorage, 's1'))
})

const notices: [CommissionedIdeasPhase, RegExp | null][] = [
  ['registration', null],
  ['presentation', /you can vote once/],
  ['voting', /you can vote once/],
  ['results', /voting has closed/],
]

for (const [phase, expected] of notices) {
  void test(`lateArrivalNotice(${phase})`, () => {
    const notice = lateArrivalNotice(phase)
    if (expected === null) {
      assert.equal(notice, null)
    } else {
      assert.match(notice ?? '', expected)
      assert.match(notice ?? '', /^Teams are already formed/)
      if (phase === 'results') assert.doesNotMatch(notice ?? '', /can vote/)
    }
  })
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { generateParticipantId } from './core/participantIds.js'

void test('generateParticipantId returns a 16-character lowercase hex identifier', () => {
  const participantId = generateParticipantId()

  assert.match(participantId, /^[a-f0-9]{16}$/)
})

void test('generateParticipantId produces unique values across a small sample', () => {
  const ids = new Set<string>()

  for (let index = 0; index < 32; index += 1) {
    ids.add(generateParticipantId())
  }

  assert.equal(ids.size, 32)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { getStudentPresenceEmptyMessage, normalizeStudentPresence } from './studentPresenceUtils'

void test('getStudentPresenceEmptyMessage distinguishes a search miss from an empty roster', () => {
  assert.equal(getStudentPresenceEmptyMessage('Lin', false), 'No students match your search.')
  assert.equal(getStudentPresenceEmptyMessage('   ', false), 'No connected students yet.')
  assert.equal(getStudentPresenceEmptyMessage('', true), 'No students yet.')
})

void test('normalizeStudentPresence filters malformed entries, derives count, and orders connected students first', () => {
  assert.deepEqual(normalizeStudentPresence({ connectedCount: 1.5, students: [{ studentId: ' b ', name: ' Beatrice ', secondaryLabel: ' Team 1 ', connected: false }, { studentId: 'a', name: 'Ada', connected: true }, {}] }), {
    connectedCount: 1,
    entries: [{ participantId: 'a', displayName: 'Ada', connected: true }, { participantId: 'b', displayName: 'Beatrice', connected: false, secondaryLabel: 'Team 1' }],
  })
})

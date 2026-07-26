import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStudentPresence } from './studentPresenceUtils'

void test('normalizeStudentPresence filters malformed entries, derives count, and orders connected students first', () => {
  assert.deepEqual(normalizeStudentPresence({ students: [{ studentId: ' b ', name: ' Beatrice ', connected: false }, { studentId: 'a', name: 'Ada', connected: true }, {}] }), {
    connectedCount: 1,
    entries: [{ participantId: 'a', displayName: 'Ada', connected: true }, { participantId: 'b', displayName: 'Beatrice', connected: false }],
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { shownBallotAllocations } from './VotingBallot.js'

const local = { allocations: [{ teamId: 'A', amount: 500 as const }], revision: 7 }
const server = { allocations: [{ teamId: 'B', amount: 500 as const }] }

void test('shownBallotAllocations shows the local ballot only while the snapshot is older than it', () => {
  assert.equal(shownBallotAllocations(local, null, 6)?.[0]?.teamId, 'A', 'snapshot not caught up yet')
  assert.equal(shownBallotAllocations(local, server, 7)?.[0]?.teamId, 'B', 'snapshot reached the submit revision')
  assert.equal(shownBallotAllocations(local, server, 9)?.[0]?.teamId, 'B', 'a newer ballot from another tab wins over a delayed response')
  assert.equal(shownBallotAllocations(null, server, 1)?.[0]?.teamId, 'B')
  assert.equal(shownBallotAllocations(null, null, 1), null)
})

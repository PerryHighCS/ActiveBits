import test from 'node:test'
import assert from 'node:assert/strict'
import { shownVote, type PendingVote } from './TeamNamingPanel.js'

const cases: [string, PendingVote | null, string | null, number, string | null][] = [
  ['nothing pending → snapshot vote', null, 'A', 5, 'A'],
  ['in flight → the vote just made', { proposalId: 'B', revision: null }, 'A', 5, 'B'],
  ['committed, snapshot not caught up → the vote just made', { proposalId: 'B', revision: 6 }, 'A', 5, 'B'],
  ['snapshot reached the vote → snapshot vote', { proposalId: 'B', revision: 6 }, 'B', 6, 'B'],
  // Another tab restored A after this tab's vote for B: myVote is unchanged (A), but the
  // snapshot is past B's revision, so the radio must follow it.
  ['another tab restored the earlier vote → snapshot vote', { proposalId: 'B', revision: 6 }, 'A', 7, 'A'],
  ['no vote in the snapshot, pending released', { proposalId: 'B', revision: 6 }, null, 8, null],
]

for (const [name, pending, myVote, revision, expected] of cases) {
  void test(`shownVote: ${name}`, () => {
    assert.equal(shownVote(pending, myVote, revision), expected)
  })
}

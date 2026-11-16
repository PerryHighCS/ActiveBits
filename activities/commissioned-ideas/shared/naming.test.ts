import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countVotes,
  normalizeProposalKind,
  proposalMatchKey,
  resolveLeadingProposal,
  resolveTeamNames,
} from './naming.js'
import type { NameProposal } from './types.js'

function proposal(id: string, value: string, createdAt: number, rejected = false): NameProposal {
  return { id, value, proposedByParticipantId: 'x', createdAt, rejectedByInstructor: rejected }
}

// Decision table for the team naming contract.
// Each row: proposals, votes, eligible voters (team members), expected display value.
const members = new Set(['alice', 'bob', 'carol'])
const resolutionCases: {
  name: string
  proposals: NameProposal[]
  votes: Record<string, string>
  voters?: Set<string>
  expected: string | null
}[] = [
  { name: 'no proposals → null', proposals: [], votes: {}, voters: members, expected: null },
  {
    name: 'all proposals rejected → null',
    proposals: [proposal('a', 'Alpha', 1, true)],
    votes: { alice: 'a' },
    voters: members,
    expected: null,
  },
  {
    name: 'ordinary majority wins',
    proposals: [proposal('a', 'Alpha', 1), proposal('b', 'Beta', 2)],
    votes: { alice: 'b', bob: 'b', carol: 'a' },
    voters: members,
    expected: 'Beta',
  },
  {
    name: 'tie breaks to earlier createdAt',
    proposals: [proposal('z', 'Later', 5), proposal('y', 'Earlier', 3)],
    votes: { alice: 'z', bob: 'y' },
    voters: members,
    expected: 'Earlier',
  },
  {
    name: 'tie with equal createdAt keeps the earlier-listed proposal (ids are random)',
    proposals: [proposal('zz', 'Listed first', 1), proposal('aa', 'Listed second', 1)],
    votes: { alice: 'zz', bob: 'aa' },
    voters: members,
    expected: 'Listed first',
  },
  {
    name: 'zero votes everywhere picks earliest proposal',
    proposals: [proposal('b', 'Second', 2), proposal('a', 'First', 1)],
    votes: {},
    voters: members,
    expected: 'First',
  },
  {
    name: 'rejected leader falls through to next eligible',
    proposals: [proposal('a', 'Bad', 1, true), proposal('b', 'Good', 2)],
    votes: { alice: 'a', bob: 'a', carol: 'b' },
    voters: members,
    expected: 'Good',
  },
  {
    name: 'votes from non-members are ignored',
    proposals: [proposal('a', 'Alpha', 1), proposal('b', 'Beta', 2)],
    votes: { alice: 'a', outsider1: 'b', outsider2: 'b' },
    voters: members,
    expected: 'Alpha',
  },
  {
    name: 'votes for unknown proposals are ignored',
    proposals: [proposal('a', 'Alpha', 2), proposal('b', 'Beta', 1)],
    votes: { alice: 'ghost', bob: 'ghost', carol: 'a' },
    voters: members,
    expected: 'Alpha',
  },
  {
    name: 'without a voter filter every vote counts',
    proposals: [proposal('a', 'Alpha', 1), proposal('b', 'Beta', 2)],
    votes: { anyone: 'b' },
    expected: 'Beta',
  },
]

for (const row of resolutionCases) {
  void test(`resolveLeadingProposal: ${row.name}`, () => {
    assert.equal(resolveLeadingProposal(row.proposals, row.votes, row.voters), row.expected)
  })
}

void test('resolveTeamNames resolves group and project names independently using member votes', () => {
  const result = resolveTeamNames({
    memberIds: ['alice', 'bob'],
    proposedGroupNames: [proposal('g1', 'Owls', 1), proposal('g2', 'Hawks', 2)],
    proposedProjectNames: [proposal('p1', 'Solar Oven', 1)],
    groupNameVotes: { alice: 'g2', bob: 'g2', departed: 'g1' },
    projectNameVotes: { alice: 'p1' },
  })
  assert.deepEqual(result, { groupName: 'Hawks', projectName: 'Solar Oven' })
})

void test('countVotes omits rejected proposals and filters voters', () => {
  const tally = countVotes(
    [proposal('a', 'A', 1), proposal('b', 'B', 2, true)],
    { alice: 'a', bob: 'b', outsider: 'a' },
    new Set(['alice', 'bob']),
  )
  assert.equal(tally.get('a'), 1)
  assert.equal(tally.has('b'), false)
})

void test('proposalMatchKey treats case and internal whitespace as equivalent', () => {
  assert.equal(proposalMatchKey('  The   Owls '), proposalMatchKey('the owls'))
  assert.notEqual(proposalMatchKey('Owls'), proposalMatchKey('Owl'))
})

void test('normalizeProposalKind accepts only group and project', () => {
  assert.equal(normalizeProposalKind('group'), 'group')
  assert.equal(normalizeProposalKind('project'), 'project')
  assert.equal(normalizeProposalKind('team'), null)
  assert.equal(normalizeProposalKind(undefined), null)
})

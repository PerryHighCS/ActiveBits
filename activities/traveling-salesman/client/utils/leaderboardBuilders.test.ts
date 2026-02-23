import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManagerLeaderboardEntries, buildSoloLeaderboardEntries } from './leaderboardBuilders'

void test('buildManagerLeaderboardEntries adds algorithm placeholders and sorts complete first', () => {
  const entries = buildManagerLeaderboardEntries({
    leaderboard: [
      {
        id: 'student-1',
        name: 'S1',
        distance: 120,
        timeToComplete: 30,
        type: 'student',
        complete: true,
      },
    ],
  })

  assert.equal(entries.length, 3)
  assert.equal(entries[0]?.id, 'student-1')
  assert.ok(entries.some((entry) => entry.id === 'bruteforce'))
  assert.ok(entries.some((entry) => entry.id === 'heuristic'))
})

void test('buildSoloLeaderboardEntries returns non-empty sorted entries when solo data exists', () => {
  const { sortedEntries, showSoloAlgorithms } = buildSoloLeaderboardEntries({
    isSoloSession: true,
    currentRoute: ['city-0', 'city-1'],
    currentDistance: 12,
    citiesLength: 3,
    soloAlgorithms: {
      heuristic: { distance: 20, computeTime: 0.1 },
    },
  })

  assert.equal(showSoloAlgorithms, true)
  assert.equal(sortedEntries.length >= 2, true)
  assert.equal(sortedEntries[0]?.distance, 20)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { assignAward, draftFromBallot, draftToAllocations } from './ballotDraft.js'

void test('assignAward sets an empty slot', () => {
  assert.deepEqual(assignAward({}, 500, 'a'), { 500: 'a' })
})

void test('assignAward moving a team to another amount frees its old amount', () => {
  assert.deepEqual(assignAward({ 500: 'a', 300: 'b' }, 300, 'a'), { 300: 'a' })
})

void test('assignAward replacing the holder of an amount keeps other awards', () => {
  assert.deepEqual(assignAward({ 500: 'a', 300: 'b' }, 500, 'c'), { 500: 'c', 300: 'b' })
})

void test('assignAward reselecting the same team is stable', () => {
  assert.deepEqual(assignAward({ 500: 'a', 300: 'b' }, 500, 'a'), { 500: 'a', 300: 'b' })
})

void test('draftFromBallot keeps only required amounts on eligible teams', () => {
  const ballot = {
    allocations: [
      { teamId: 'a', amount: 500 as const },
      { teamId: 'own', amount: 300 as const },
      { teamId: 'c', amount: 100 as const },
    ],
  }
  assert.deepEqual(draftFromBallot(ballot, [500, 300], ['a', 'c']), { 500: 'a' })
  assert.deepEqual(draftFromBallot(null, [500], ['a']), {})
})

void test('draftToAllocations returns null until every required award is placed', () => {
  const eligible = new Set(['a', 'b'])
  assert.equal(draftToAllocations({ 500: 'a' }, [500, 300], eligible), null)
  assert.deepEqual(draftToAllocations({ 500: 'a', 300: 'b' }, [500, 300], eligible), [
    { teamId: 'a', amount: 500 },
    { teamId: 'b', amount: 300 },
  ])
  assert.deepEqual(draftToAllocations({}, [], eligible), [])
})

void test('draftToAllocations treats an award held by a no-longer-eligible team as unassigned', () => {
  // Team b was deleted by moderation while the draft was open.
  assert.equal(draftToAllocations({ 500: 'a', 300: 'b' }, [500, 300], new Set(['a', 'c'])), null)
  assert.deepEqual(draftToAllocations({ 500: 'a', 300: 'c' }, [500, 300], new Set(['a', 'c'])), [
    { teamId: 'a', amount: 500 },
    { teamId: 'c', amount: 300 },
  ])
})

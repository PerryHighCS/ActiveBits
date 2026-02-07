import test from 'node:test'
import assert from 'node:assert/strict'
import { drawWinningTickets, resolveRaffleSelectionSize } from './raffleUtils'

test('resolveRaffleSelectionSize enforces group minimum and upper bound behavior', () => {
  assert.equal(resolveRaffleSelectionSize(-1, 2), null)
  assert.equal(resolveRaffleSelectionSize(-1, 7, () => 0), 3)
  assert.equal(resolveRaffleSelectionSize(-1, 20, () => 0.99), 6)
})

test('resolveRaffleSelectionSize preserves non-group counts when available', () => {
  assert.equal(resolveRaffleSelectionSize(1, 3), 1)
  assert.equal(resolveRaffleSelectionSize(2, 1), null)
})

test('drawWinningTickets returns unique winners from ticket pool', () => {
  const sequence = [0.1, 0.1, 0.6, 0.9]
  let cursor = 0
  const winners = drawWinningTickets([10, 20, 30], 3, () => {
    const value = sequence[cursor] ?? 0.9
    cursor += 1
    return value
  })

  assert.deepEqual(winners, [10, 20, 30])
})

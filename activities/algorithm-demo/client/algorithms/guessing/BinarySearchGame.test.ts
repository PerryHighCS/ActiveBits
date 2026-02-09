import test from 'node:test'
import assert from 'node:assert/strict'
import BinarySearchGame from './BinarySearchGame'

interface BinarySearchGameStateLike {
  maxN: number
  secret: number | null
  guesses: Array<Record<string, unknown>>
  won: boolean
  hint: { type: string; message: string } | null
  maxGuessesNeeded: number
  mode: 'human' | 'computer'
  computerState: {
    low: number
    high: number
    currentGuess: number
    waitingForFeedback: boolean
    started: boolean
  } | null
}

void test('BinarySearchGame initState builds expected mode-specific defaults', () => {
  const human = BinarySearchGame.initState?.(64, 'human') as unknown as BinarySearchGameStateLike
  assert.equal(human.mode, 'human')
  assert.equal(typeof human.secret, 'number')
  assert.equal(human.computerState, null)
  assert.equal(human.maxGuessesNeeded, 6)

  const computer = BinarySearchGame.initState?.(64, 'computer') as unknown as BinarySearchGameStateLike
  assert.equal(computer.mode, 'computer')
  assert.equal(computer.secret, null)
  assert.equal(computer.computerState?.low, 1)
  assert.equal(computer.computerState?.high, 64)
  assert.equal(computer.computerState?.started, false)
})

void test('BinarySearchGame reduceEvent handles mode switches and computer lifecycle', () => {
  const initial = BinarySearchGame.initState?.(32, 'computer') as unknown as BinarySearchGameStateLike

  const started = BinarySearchGame.reduceEvent?.(
    initial as unknown as Record<string, unknown>,
    { type: 'computerStart' },
  ) as unknown as BinarySearchGameStateLike
  assert.equal(started.computerState?.started, true)
  assert.equal(started.computerState?.waitingForFeedback, true)

  const feedback = BinarySearchGame.reduceEvent?.(
    started as unknown as Record<string, unknown>,
    { type: 'computerFeedback', payload: 'low' },
  ) as unknown as BinarySearchGameStateLike
  assert.equal(feedback.guesses.length, 1)
  assert.equal(feedback.won, false)
  assert.equal(feedback.computerState?.started, false)

  const switched = BinarySearchGame.reduceEvent?.(
    feedback as unknown as Record<string, unknown>,
    { type: 'setMode', payload: 'human' },
  ) as unknown as BinarySearchGameStateLike
  assert.equal(switched.mode, 'human')
  assert.equal(switched.computerState, null)
})

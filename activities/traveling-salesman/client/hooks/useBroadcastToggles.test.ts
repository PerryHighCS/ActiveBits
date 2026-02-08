import test from 'node:test'
import assert from 'node:assert/strict'
import { nextBroadcastSnapshot } from './useBroadcastToggles'

test('nextBroadcastSnapshot applies broadcastUpdate payload routes', () => {
  const next = nextBroadcastSnapshot([], {
    type: 'broadcastUpdate',
    payload: {
      routes: [{ id: 'r1', type: 'student', name: 'Route 1' }],
    },
  }, 0)

  assert.equal(next.length, 1)
  assert.equal(next[0]?.id, 'r1')
})

test('nextBroadcastSnapshot keeps snapshot on clearBroadcast when toggles active', () => {
  const current = [{ id: 'x', type: 'student', name: 'Keep me' }]
  const next = nextBroadcastSnapshot(current, { type: 'clearBroadcast' }, 1)
  assert.deepEqual(next, current)
})

test('nextBroadcastSnapshot clears on problemUpdate', () => {
  const next = nextBroadcastSnapshot([{ id: 'x', type: 'student', name: 'Old' }], { type: 'problemUpdate' }, 0)
  assert.deepEqual(next, [])
})

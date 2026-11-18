import test from 'node:test'
import assert from 'node:assert/strict'
import { isRevealPending } from './ResultsDashboard.js'

void test('isRevealPending releases only at or after the reveal’s committed revision', () => {
  assert.equal(isRevealPending(null, 3), false)
  assert.equal(isRevealPending({ kind: 'in-flight' }, 99), true, 'no answer yet')
  assert.equal(isRevealPending({ kind: 'awaiting-snapshot', revision: 5 }, 4), true, 'response arrived before the snapshot')
  assert.equal(isRevealPending({ kind: 'awaiting-snapshot', revision: 5 }, 5), false)
  assert.equal(isRevealPending({ kind: 'awaiting-snapshot', revision: 5 }, 8), false, 'a reconnect snapshot past the write releases it, whatever the step shows')
})

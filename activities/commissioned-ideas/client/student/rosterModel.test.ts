import test from 'node:test'
import assert from 'node:assert/strict'
import { teamControlsLocked } from './rosterModel.js'

const cases: [string, Parameters<typeof teamControlsLocked>, boolean][] = [
  ['idle, nothing awaited', [false, null, 7], false],
  ['request in flight', [true, null, 7], true],
  ['committed at 8, snapshot still 7 → locked', [false, 8, 7], true],
  ['snapshot reached the write', [false, 8, 8], false],
  ['snapshot past the write', [false, 8, 9], false],
  ['busy again while a newer snapshot arrived', [true, 8, 9], true],
]

for (const [name, args, expected] of cases) {
  void test(`teamControlsLocked: ${name}`, () => {
    assert.equal(teamControlsLocked(...args), expected)
  })
}

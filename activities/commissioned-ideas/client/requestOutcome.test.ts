import test from 'node:test'
import assert from 'node:assert/strict'
import { lockedUntilSnapshot, outcomeKindForStatus } from './requestOutcome.js'

const cases: [number, ReturnType<typeof outcomeKindForStatus>][] = [
  [200, 'ok'],
  [204, 'ok'],
  [400, 'refused'],
  [403, 'refused'],
  [404, 'refused'],
  [409, 'refused'],
  [429, 'refused'],
  [500, 'unknown'],
  [502, 'unknown'],
  [503, 'unknown'],
]

for (const [status, expected] of cases) {
  void test(`outcomeKindForStatus(${status}) → ${expected}`, () => {
    assert.equal(outcomeKindForStatus(status), expected)
  })
}

const lockCases: [string, Parameters<typeof lockedUntilSnapshot>, boolean][] = [
  ['idle, nothing awaited', [false, null, 7], false],
  ['request in flight', [true, null, 7], true],
  ['committed at 8, snapshot still 7 → locked', [false, 8, 7], true],
  ['snapshot reached the write', [false, 8, 8], false],
  ['snapshot past the write', [false, 8, 9], false],
  ['busy again while a newer snapshot arrived', [true, 8, 9], true],
]

for (const [name, args, expected] of lockCases) {
  void test(`lockedUntilSnapshot: ${name}`, () => {
    assert.equal(lockedUntilSnapshot(...args), expected)
  })
}

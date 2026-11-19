import test from 'node:test'
import assert from 'node:assert/strict'
import { outcomeKindForStatus } from './requestOutcome.js'

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

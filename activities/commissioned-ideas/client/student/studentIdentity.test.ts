import test from 'node:test'
import assert from 'node:assert/strict'
import type { CommissionedIdeasPhase } from '../../shared/types.js'
import { lateArrivalNotice } from './studentIdentity.js'

const notices: [CommissionedIdeasPhase, RegExp | null][] = [
  ['registration', null],
  ['presentation', /you can vote once/],
  ['voting', /you can vote once/],
  ['results', /voting has closed/],
]

for (const [phase, expected] of notices) {
  void test(`lateArrivalNotice(${phase})`, () => {
    const notice = lateArrivalNotice(phase)
    if (expected === null) {
      assert.equal(notice, null)
    } else {
      assert.match(notice ?? '', expected)
      assert.match(notice ?? '', /^Teams are already formed/)
      if (phase === 'results') assert.doesNotMatch(notice ?? '', /can vote/)
    }
  })
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { LATE_ARRIVAL_CONTROL_ATTR, lateArrivalFocusTarget } from './lateArrivalsModel.js'

const control = (id: string, kind: 'select' | 'reject', disabled = false) => ({
  name: `${id}:${kind}`,
  getAttribute: (attr: string) => (attr === LATE_ARRIVAL_CONTROL_ATTR ? id : null),
  matches: (selector: string) => selector === ':disabled' && disabled,
})
type Control = ReturnType<typeof control>
const list = (...controls: Control[]) => controls
const done = control('-', 'select')
const pick = (l: Control[], preferred: string | null) => lateArrivalFocusTarget(l, preferred, done)?.name

const cases: [string, Control[], string | null, string][] = [
  ['preferred student’s select', list(control('ann', 'select'), control('ann', 'reject'), control('bob', 'select'), control('bob', 'reject')), 'bob', 'bob:select'],
  ['no teams: select disabled → preferred student’s Reject', list(control('bob', 'select', true), control('bob', 'reject')), 'bob', 'bob:reject'],
  ['preferred row all disabled → another student’s enabled control', list(control('ann', 'select'), control('bob', 'select', true), control('bob', 'reject', true)), 'bob', 'ann:select'],
  ['preferred gone → first enabled', list(control('ann', 'select', true), control('ann', 'reject')), 'zed', 'ann:reject'],
  ['everything disabled (busy) → preferred row’s first control, to wait on', list(control('ann', 'select', true), control('bob', 'select', true), control('bob', 'reject', true)), 'bob', 'bob:select'],
  ['nobody waiting → "all placed" status', list(), 'bob', '-:select'],
]

for (const [name, l, preferred, expected] of cases) {
  void test(`lateArrivalFocusTarget: ${name}`, () => {
    assert.equal(pick(l, preferred), expected)
  })
}

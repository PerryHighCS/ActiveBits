import test from 'node:test'
import assert from 'node:assert/strict'
import { focusRestoreDecision, type FocusRestoreDecision } from './useRestoreFocusAfterRemoval.js'

type State = Parameters<typeof focusRestoreDecision>[0]
const state = (outcome: State['outcome'], originConnected: boolean, originFocusable: boolean, focusLost: boolean, targetFocusable = true): State =>
  ({ outcome, originConnected, originFocusable, targetFocusable, focusLost })
const keep = (focus: FocusRestoreDecision['focus']): FocusRestoreDecision => ({ focus, keepTracking: true })
const stop = (focus: FocusRestoreDecision['focus']): FocusRestoreDecision => ({ focus, keepTracking: false })

const cases: [string, State, FocusRestoreDecision][] = [
  // Control removed (the change landed).
  ['removed while pending (snapshot first), focus lost → target', state('pending', false, false, true), stop('target')],
  ['removed after commit, focus lost → target', state('committed', false, false, true), stop('target')],
  ['removed although the response was lost → target', state('unknown', false, false, true), stop('target')],
  ['removed, but the user focused something else → leave it', state('committed', false, false, false), keep(null)],
  ['removed while the target is still disabled (busy) → wait for it', state('pending', false, false, true, false), keep(null)],
  ['removed after commit, target not focusable yet → wait', state('committed', false, false, true, false), keep(null)],
  // Control still there and disabled (busy): focusing it would do nothing.
  ['pending and disabled → wait', state('pending', true, false, true), keep(null)],
  ['refused while still disabled → wait for the render that enables it', state('refused', true, false, true), keep(null)],
  ['unknown while still disabled → wait', state('unknown', true, false, true), keep(null)],
  // Control still there and enabled.
  ['refused and enabled → back to it, stop', state('refused', true, true, true), stop('origin')],
  ['unknown and enabled → back to it, keep watching for removal', state('unknown', true, true, true), keep('origin')],
  ['committed, snapshot not yet applied → wait', state('committed', true, true, true), keep(null)],
  // Focus is somewhere (for example back on the control after an unknown outcome).
  ['unknown, focus on the control → keep watching', state('unknown', true, true, false), keep(null)],
  ['refused, focus already somewhere → stop', state('refused', true, true, false), stop(null)],
]

for (const [name, input, expected] of cases) {
  void test(`focusRestoreDecision: ${name}`, () => {
    assert.deepEqual(focusRestoreDecision(input), expected)
  })
}

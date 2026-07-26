import assert from 'node:assert/strict'
import test from 'node:test'
import { openMobCodeRunnerPopupShell } from './runnerPopupShell'

void test('openMobCodeRunnerPopupShell opens and focuses a blank popup during the click event', () => {
  let openedUrl = 'not-called'
  let focused = false
  const result = openMobCodeRunnerPopupShell({
    open(url?: string | URL, target?: string, features?: string) {
      openedUrl = String(url ?? '')
      assert.equal(target, '_blank')
      assert.match(features ?? '', /width=1120/)
      return { focus: () => { focused = true } }
    },
  })

  assert.equal(openedUrl, '')
  assert.equal(focused, true)
  assert.equal(result.opened, true)
  assert.ok(result.popup)
})

void test('openMobCodeRunnerPopupShell reports a blocked popup', () => {
  assert.deepEqual(openMobCodeRunnerPopupShell({ open: () => null }), {
    opened: false,
    reason: 'popup-blocked',
  })
})

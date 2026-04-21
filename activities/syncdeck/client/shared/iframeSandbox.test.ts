import assert from 'node:assert/strict'
import test from 'node:test'
import { SYNCDECK_IFRAME_SANDBOX } from './iframeSandbox.js'

void test('SYNCDECK_IFRAME_SANDBOX preserves iframe isolation while allowing external links to open in new tabs', () => {
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-scripts\b/)
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-same-origin\b/)
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-popups\b/)
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-popups-to-escape-sandbox\b/)
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-forms\b/)
  assert.doesNotMatch(SYNCDECK_IFRAME_SANDBOX, /\ballow-top-navigation\b/)
  assert.doesNotMatch(SYNCDECK_IFRAME_SANDBOX, /\ballow-top-navigation-by-user-activation\b/)
})

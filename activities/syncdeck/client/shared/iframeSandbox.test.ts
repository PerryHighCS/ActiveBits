import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SYNCDECK_IFRAME_SANDBOX,
  SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS,
} from './iframeSandbox.js'

void test('SYNCDECK_IFRAME_SANDBOX preserves iframe isolation for embedded/internal iframes', () => {
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-scripts\b/)
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-same-origin\b/)
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-popups\b/)
  assert.match(SYNCDECK_IFRAME_SANDBOX, /\ballow-forms\b/)
  assert.doesNotMatch(SYNCDECK_IFRAME_SANDBOX, /\ballow-popups-to-escape-sandbox\b/)
  assert.doesNotMatch(SYNCDECK_IFRAME_SANDBOX, /\ballow-top-navigation\b/)
  assert.doesNotMatch(SYNCDECK_IFRAME_SANDBOX, /\ballow-top-navigation-by-user-activation\b/)
})

void test('SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS allows presentation links to open normal new tabs', () => {
  assert.match(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS, /\ballow-scripts\b/)
  assert.match(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS, /\ballow-same-origin\b/)
  assert.match(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS, /\ballow-popups\b/)
  assert.match(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS, /\ballow-popups-to-escape-sandbox\b/)
  assert.match(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS, /\ballow-forms\b/)
  assert.doesNotMatch(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS, /\ballow-top-navigation\b/)
  assert.doesNotMatch(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS, /\ballow-top-navigation-by-user-activation\b/)
})

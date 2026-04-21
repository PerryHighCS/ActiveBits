import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SYNCDECK_IFRAME_SANDBOX,
  SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS,
} from './iframeSandbox.js'

function sandboxTokens(sandbox: string): string[] {
  return sandbox.trim().split(/\s+/).sort()
}

void test('SYNCDECK_IFRAME_SANDBOX preserves iframe isolation for embedded/internal iframes', () => {
  assert.deepEqual(sandboxTokens(SYNCDECK_IFRAME_SANDBOX), [
    'allow-forms',
    'allow-popups',
    'allow-same-origin',
    'allow-scripts',
  ])
})

void test('SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS allows presentation links to open normal new tabs', () => {
  assert.deepEqual(sandboxTokens(SYNCDECK_PRESENTATION_IFRAME_SANDBOX_WITH_UNSANDBOXED_POPUPS), [
    'allow-forms',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-same-origin',
    'allow-scripts',
  ])
})

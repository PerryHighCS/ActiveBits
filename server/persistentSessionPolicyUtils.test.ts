import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSoloOnlyPolicyRejection } from './core/persistentSessionPolicyUtils.js'

void test('buildSoloOnlyPolicyRejection returns the shared solo-only rejection payload', () => {
  assert.deepEqual(buildSoloOnlyPolicyRejection(), {
    error: 'This permanent link is configured for solo use only.',
    code: 'entry-policy-rejected',
    entryPolicy: 'solo-only',
  })
})

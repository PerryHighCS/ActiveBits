import assert from 'node:assert/strict'
import test from 'node:test'
import { registerSoloLaunchOptionsValidator, validateSoloLaunchOptions } from './core/soloLaunchValidation.js'

void test('solo launch validation uses the activity\'s registered validator and accepts unregistered activities', () => {
  registerSoloLaunchOptionsValidator('solo-validation-test', (options) => (
    typeof options.required === 'string' ? { ok: true } : { ok: false, error: 'required option missing' }
  ))

  assert.deepEqual(validateSoloLaunchOptions('solo-validation-test', { required: 'x' }), { ok: true })
  assert.deepEqual(validateSoloLaunchOptions('solo-validation-test', {}), { ok: false, error: 'required option missing' })
  assert.deepEqual(validateSoloLaunchOptions('solo-validation-unregistered', {}), { ok: true })
  assert.throws(() => registerSoloLaunchOptionsValidator('', () => ({ ok: true })), /non-empty activity type/)
})

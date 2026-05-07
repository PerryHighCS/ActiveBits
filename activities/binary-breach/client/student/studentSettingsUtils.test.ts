import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_BINARY_BREACH_SETTINGS } from '../../shared/challengeGenerator.js'
import { normalizeStudentMissionSettings } from './studentSettingsUtils.js'

void test('normalizes missing student mission settings to defaults', () => {
  assert.deepEqual(normalizeStudentMissionSettings(undefined), DEFAULT_BINARY_BREACH_SETTINGS)
})

void test('keeps valid student mission settings from the server payload', () => {
  assert.deepEqual(normalizeStudentMissionSettings({
    maxBits: 4,
    missionLength: 3,
    challengeTypes: ['binary-to-decimal'],
    timerMode: 'off',
    hintsEnabled: false,
    placeValueSupport: 'hidden',
  }), {
    maxBits: 4,
    missionLength: 3,
    challengeTypes: ['binary-to-decimal'],
    timerMode: 'off',
    hintsEnabled: false,
    placeValueSupport: 'hidden',
  })
})

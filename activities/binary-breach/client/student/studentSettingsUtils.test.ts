import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_BINARY_BREACH_SETTINGS } from '../../shared/challengeGenerator.js'
import {
  normalizeSoloMissionSettingsFromSearch,
  normalizeStudentMissionSettings,
  normalizeStudentMissionSettingsFromLaunchOptions,
} from './studentSettingsUtils.js'

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

void test('normalizes Binary Breach solo launch options from selected options', () => {
  assert.deepEqual(normalizeStudentMissionSettingsFromLaunchOptions({
    maxBits: '4',
    missionLength: '3',
    challengeTypes: 'binary-to-decimal, decimal-to-binary',
    hintsEnabled: 'false',
    placeValueSupport: 'optional',
  }), {
    maxBits: 4,
    missionLength: 3,
    challengeTypes: ['binary-to-decimal', 'decimal-to-binary'],
    timerMode: 'off',
    hintsEnabled: false,
    placeValueSupport: 'optional',
  })
})

void test('normalizes Binary Breach solo launch options from query strings', () => {
  assert.deepEqual(normalizeSoloMissionSettingsFromSearch(
    '?maxBits=5&missionLength=4&challengeTypes=order-binary,%20compare-binary&hintsEnabled=false&placeValueSupport=hidden',
  ), {
    maxBits: 5,
    missionLength: 4,
    challengeTypes: ['order-binary', 'compare-binary'],
    timerMode: 'off',
    hintsEnabled: false,
    placeValueSupport: 'hidden',
  })
})

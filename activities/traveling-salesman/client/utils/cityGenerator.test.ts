import test from 'node:test'
import assert from 'node:assert/strict'
import { generateCities } from './cityGenerator'

void test('generateCities throws when count exceeds available names', () => {
  assert.throws(() => generateCities(26, 700, 500, 123), /only 25 names available/i)
})

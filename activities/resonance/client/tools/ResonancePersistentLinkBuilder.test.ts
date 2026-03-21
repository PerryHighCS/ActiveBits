import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEditStateQuestions } from './ResonancePersistentLinkBuilder.js'

void test('normalizeEditStateQuestions returns normalized non-empty questions for valid input', () => {
  const result = normalizeEditStateQuestions([
    {
      id: 'q1',
      type: 'free-response',
      text: '  Hello world  ',
      order: 0,
      extraField: 'should-be-stripped',
    },
  ])

  assert.ok(result !== null)
  assert.equal(result.length, 1)
  assert.equal(result[0]?.text, 'Hello world')
  assert.ok(!Object.prototype.hasOwnProperty.call(result[0] as object, 'extraField'))
})

void test('normalizeEditStateQuestions returns null for invalid question shapes', () => {
  const result = normalizeEditStateQuestions([
    {
      id: 'q1',
      type: 'essay',
      text: 'Invalid type',
      order: 0,
    },
  ])

  assert.equal(result, null)
})

void test('normalizeEditStateQuestions returns null for empty arrays', () => {
  assert.equal(normalizeEditStateQuestions([]), null)
})

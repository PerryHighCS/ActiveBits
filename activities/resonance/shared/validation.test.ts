import assert from 'node:assert/strict'
import test from 'node:test'
import { validateQuestion, validateQuestionSet } from './validation.js'

void test('validateQuestion accepts underscore ids', () => {
  const errors: string[] = []
  const result = validateQuestion(
    {
      id: 'question_1',
      type: 'free-response',
      text: 'Prompt',
      order: 0,
    },
    errors,
  )

  assert.deepEqual(errors, [])
  assert.ok(result)
  assert.equal(result.id, 'question_1')
})

void test('validateQuestionSet treats duplicate question ids as invalid input', () => {
  const result = validateQuestionSet([
    {
      id: 'q1',
      type: 'free-response',
      text: 'First prompt',
      order: 0,
    },
    {
      id: 'q1',
      type: 'free-response',
      text: 'Second prompt',
      order: 1,
    },
  ])

  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.errors, ['question ids must be unique within a set'])
})

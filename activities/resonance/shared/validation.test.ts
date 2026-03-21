import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGimkitCSV, validateQuestion, validateQuestionSet } from './validation.js'

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

void test('parseGimkitCSV enforces max 100 parsed questions', () => {
  const header = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
  ]

  const rows = Array.from({ length: 101 }, (_, i) => `"Question ${i + 1}","Correct ${i + 1}","Wrong ${i + 1}"`)
  const csv = [...header, ...rows].join('\n')

  const result = parseGimkitCSV(csv)

  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.errors, ['question set may contain at most 100 questions'])
})

void test('parseGimkitCSV accepts exactly 100 parsed questions', () => {
  const header = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
  ]

  const rows = Array.from({ length: 100 }, (_, i) => `"Question ${i + 1}","Correct ${i + 1}","Wrong ${i + 1}"`)
  const csv = [...header, ...rows].join('\n')

  const result = parseGimkitCSV(csv)

  assert.equal(result.errors.length, 0)
  assert.equal(result.questions.length, 100)
})

void test('parseGimkitCSV rejects rows without a correct answer', () => {
  const csv = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
    '"Favorite color","","Red","Blue",""',
  ].join('\n')

  const result = parseGimkitCSV(csv)

  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.errors, [
    'Row 3: Gimkit CSV requires a correct answer for multiple-choice questions',
  ])
})

void test('parseGimkitCSV rejects rows without any incorrect answers', () => {
  const csv = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
    '"Explain why","Because","","",""',
  ].join('\n')

  const result = parseGimkitCSV(csv)

  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.errors, [
    'Row 3: Gimkit CSV requires at least one incorrect answer for multiple-choice questions',
  ])
})

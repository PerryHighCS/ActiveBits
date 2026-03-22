import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGimkitCSV, parseGimkitCSVWithRandom, validateQuestion, validateQuestionSet } from './validation.js'

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

void test('parseGimkitCSV rejects rows with more than three incorrect answers', () => {
  const csv = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
    '"Pick one","A","B","C","D","E"',
  ].join('\n')

  const result = parseGimkitCSV(csv)

  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.errors, [
    'Row 3: Gimkit CSV supports at most 3 incorrect answers',
  ])
})

void test('parseGimkitCSV returns normalized validated questions', () => {
  const csv = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
    '"  Pick one  ","  Right  "," Wrong 1 "," Wrong 2 ",""',
  ].join('\n')

  const result = parseGimkitCSVWithRandom(csv, () => 0)

  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.questions, [
    {
      id: 'q1',
      type: 'multiple-choice',
      text: 'Pick one',
      order: 0,
      options: [
        { id: 'q1_i1', text: 'Wrong 1' },
        { id: 'q1_i2', text: 'Wrong 2' },
        { id: 'q1_c', text: 'Right', isCorrect: true },
      ],
    },
  ])
})

void test('parseGimkitCSV still normalizes valid rows when other rows have errors', () => {
  const longPrompt = `  ${'A'.repeat(1005)}  `
  const longCorrect = `  ${'B'.repeat(505)}  `
  const longIncorrect = `  ${'C'.repeat(505)}  `
  const csv = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
    `"${longPrompt}","${longCorrect}","${longIncorrect}"`,
    '"Missing correct","","Wrong","",""',
  ].join('\n')

  const result = parseGimkitCSVWithRandom(csv, () => 0)

  assert.deepEqual(result.errors, [
    'Row 4: Gimkit CSV requires a correct answer for multiple-choice questions',
  ])
  assert.deepEqual(result.questions, [
    {
      id: 'q1',
      type: 'multiple-choice',
      text: 'A'.repeat(1000),
      order: 0,
      options: [
        { id: 'q1_i1', text: 'C'.repeat(500) },
        { id: 'q1_c', text: 'B'.repeat(500), isCorrect: true },
      ],
    },
  ])
})

void test('parseGimkitCSV can randomize Gimkit answer order so the correct answer is not always first', () => {
  const csv = [
    'Title',
    '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
    '"Pick one","Right","Wrong 1","Wrong 2",""',
  ].join('\n')

  const result = parseGimkitCSVWithRandom(csv, () => 0)

  assert.deepEqual(result.errors, [])
  const firstQuestion = result.questions[0]
  assert.equal(firstQuestion?.type, 'multiple-choice')
  assert.deepEqual(firstQuestion?.options, [
    { id: 'q1_i1', text: 'Wrong 1' },
    { id: 'q1_i2', text: 'Wrong 2' },
    { id: 'q1_c', text: 'Right', isCorrect: true },
  ])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFile } from './ResonanceQuestionSetUploader.js'

const GIMKIT_SAMPLE_CSV = [
  'My Question Set',
  '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
  '"What is 2+2?","4","3","5",""',
].join('\n')

void test('parseFile treats uppercase .CSV extension as CSV input', () => {
  const file = new File([''], 'QUESTIONS.CSV', { type: 'text/csv' })
  const result = parseFile(file, GIMKIT_SAMPLE_CSV)

  assert.equal(result.errors.length, 0)
  assert.equal(result.questions.length, 1)
  assert.equal(result.questions[0]?.type, 'multiple-choice')
})

void test('parseFile treats mixed-case .CsV extension as CSV input', () => {
  const file = new File([''], 'questions.CsV', { type: 'text/csv' })
  const result = parseFile(file, GIMKIT_SAMPLE_CSV)

  assert.equal(result.errors.length, 0)
  assert.equal(result.questions.length, 1)
  assert.equal(result.questions[0]?.text, 'What is 2+2?')
})

void test('parseFile loads saved Resonance question JSON exports', () => {
  const file = new File([''], 'resonance-questions.json', { type: 'application/json' })
  const result = parseFile(file, JSON.stringify([
    {
      id: 'q_saved_1',
      type: 'free-response',
      text: 'What is one thing you learned?',
      order: 0,
    },
    {
      id: 'q_saved_2',
      type: 'multiple-choice',
      text: 'Pick the true statements.',
      order: 1,
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C', isCorrect: true },
      ],
    },
  ]))

  assert.equal(result.errors.length, 0)
  assert.deepEqual(
    result.questions.map((question) => ({ id: question.id, type: question.type, order: question.order })),
    [
      { id: 'q_saved_1', type: 'free-response', order: 0 },
      { id: 'q_saved_2', type: 'multiple-choice', order: 1 },
    ],
  )
})

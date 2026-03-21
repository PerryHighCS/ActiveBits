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

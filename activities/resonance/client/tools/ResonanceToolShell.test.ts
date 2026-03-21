import assert from 'node:assert/strict'
import test from 'node:test'
import type { Question } from '../../shared/types.js'
import { isGimkitCsvExportCompatibleQuestion, questionsToCsv } from './ResonanceToolShell.js'

const SINGLE_CORRECT_MCQ: Question = {
  id: 'q1',
  type: 'multiple-choice',
  text: 'Pick one',
  order: 0,
  options: [
    { id: 'q1_a', text: 'A', isCorrect: true },
    { id: 'q1_b', text: 'B' },
    { id: 'q1_c', text: 'C' },
  ],
}

void test('isGimkitCsvExportCompatibleQuestion only accepts single-correct multiple-choice questions', () => {
  assert.equal(isGimkitCsvExportCompatibleQuestion(SINGLE_CORRECT_MCQ), true)
  assert.equal(
    isGimkitCsvExportCompatibleQuestion({
      id: 'q2',
      type: 'free-response',
      text: 'Explain why',
      order: 1,
    }),
    false,
  )
  assert.equal(
    isGimkitCsvExportCompatibleQuestion({
      id: 'q3',
      type: 'multiple-choice',
      text: 'Poll',
      order: 2,
      options: [
        { id: 'q3_a', text: 'A' },
        { id: 'q3_b', text: 'B' },
      ],
    }),
    false,
  )
})

void test('questionsToCsv exports only Gimkit-compatible questions', () => {
  const csv = questionsToCsv([
    {
      id: 'free-response',
      type: 'free-response',
      text: 'Explain "why"',
      order: 0,
    },
    SINGLE_CORRECT_MCQ,
    {
      id: 'poll',
      type: 'multiple-choice',
      text: 'Favorite color',
      order: 2,
      options: [
        { id: 'poll_a', text: 'Red' },
        { id: 'poll_b', text: 'Blue' },
      ],
    },
  ])

  assert.equal(
    csv,
    [
      'Resonance Question Set Export',
      '"Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"',
      '"Pick one","A","B","C",""',
    ].join('\n'),
  )
})

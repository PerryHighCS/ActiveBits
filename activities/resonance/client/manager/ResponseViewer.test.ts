import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  default as ResponseViewer,
  getMcqOptionColumnLabel,
  getMcqSelectionTone,
  isIncorrectMcqSelection,
  mergeDisplayOrder,
  moveResponseIdToEnd,
  reorderResponseIds,
} from './ResponseViewer.js'

void test('reorderResponseIds moves the dragged response to the target position', () => {
  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'r3', 'r1'),
    ['r3', 'r1', 'r2'],
  )

  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'r1', 'r3'),
    ['r2', 'r3', 'r1'],
  )
})

void test('reorderResponseIds leaves the order unchanged for no-op or invalid drags', () => {
  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'r2', 'r2'),
    ['r1', 'r2', 'r3'],
  )

  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'missing', 'r2'),
    ['r1', 'r2', 'r3'],
  )
})

void test('moveResponseIdToEnd moves a dragged response to the last slot', () => {
  assert.deepEqual(
    moveResponseIdToEnd(['r1', 'r2', 'r3'], 'r1'),
    ['r2', 'r3', 'r1'],
  )

  assert.deepEqual(
    moveResponseIdToEnd(['r1', 'r2', 'r3'], 'r3'),
    ['r1', 'r2', 'r3'],
  )
})

void test('mergeDisplayOrder preserves local order for existing items and appends new ones', () => {
  assert.deepEqual(
    mergeDisplayOrder(['draft:s1:q1', 'r2', 'r1'], ['r1', 'r2', 'draft:s1:q1', 'draft:s2:q1']),
    ['draft:s1:q1', 'r2', 'r1', 'draft:s2:q1'],
  )

  assert.deepEqual(
    mergeDisplayOrder(['r2', 'missing', 'r1'], ['r1', 'r2']),
    ['r2', 'r1'],
  )
})

void test('reorder helpers tolerate unexpected runtime shapes upstream', () => {
  assert.deepEqual(
    mergeDisplayOrder([], ['r1']),
    ['r1'],
  )
})

void test('getMcqSelectionTone uses emerald for correct answers, red for incorrect, and indigo for polls', () => {
  assert.deepEqual(
    getMcqSelectionTone({ isPoll: false, isCorrect: true, isIncorrect: false }),
    {
      cellClassName: 'bg-emerald-50 dark:bg-emerald-900/20',
      dotClassName: 'bg-emerald-600',
    },
  )

  assert.deepEqual(
    getMcqSelectionTone({ isPoll: false, isCorrect: false, isIncorrect: true }),
    {
      cellClassName: 'bg-red-50/70 dark:bg-red-900/10',
      dotClassName: 'bg-red-500',
    },
  )

  assert.deepEqual(
    getMcqSelectionTone({ isPoll: true, isCorrect: false, isIncorrect: false }),
    {
      cellClassName: 'bg-indigo-50 dark:bg-indigo-900/20',
      dotClassName: 'bg-indigo-500',
    },
  )
})

void test('isIncorrectMcqSelection marks undefined-isCorrect distractors as incorrect when question has a correct option', () => {
  const options = [
    { id: 'a', text: 'Correct', isCorrect: true },
    { id: 'b', text: 'Distractor' },
  ]

  assert.equal(
    isIncorrectMcqSelection({ selectedOptionIds: ['b'], options }),
    true,
  )
})

void test('isIncorrectMcqSelection does not mark poll selections as incorrect', () => {
  const options = [
    { id: 'a', text: 'Option A' },
    { id: 'b', text: 'Option B' },
  ]

  assert.equal(
    isIncorrectMcqSelection({ selectedOptionIds: ['b'], options }),
    false,
  )
})

void test('isIncorrectMcqSelection requires the full correct set for multi-select questions', () => {
  const options = [
    { id: 'a', text: 'Correct A', isCorrect: true },
    { id: 'b', text: 'Correct B', isCorrect: true },
    { id: 'c', text: 'Distractor' },
  ]

  assert.equal(
    isIncorrectMcqSelection({ selectedOptionIds: ['a'], options }),
    true,
  )
  assert.equal(
    isIncorrectMcqSelection({ selectedOptionIds: ['a', 'b'], options }),
    false,
  )
})

void test('getMcqOptionColumnLabel produces spreadsheet-style option labels', () => {
  assert.equal(getMcqOptionColumnLabel(0), 'A')
  assert.equal(getMcqOptionColumnLabel(1), 'B')
  assert.equal(getMcqOptionColumnLabel(25), 'Z')
  assert.equal(getMcqOptionColumnLabel(26), 'AA')
})

void test('ResponseViewer keeps MCQ table columns compact while showing formatted choice previews', () => {
  const html = renderToStaticMarkup(
    React.createElement(ResponseViewer, {
      question: {
        id: 'q1',
        type: 'multiple-choice',
        text: 'Choose one',
        order: 0,
        options: [
          { id: 'a', text: '![Mountain](https://example.com/mountain.png)', isCorrect: true },
          { id: 'b', text: '```python\nprint("no")\n```' },
        ],
      },
      responses: [],
      progress: [
        {
          questionId: 'q1',
          studentId: 'student-1',
          studentName: 'Ada',
          updatedAt: 1,
          status: 'submitted',
          answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
          responseId: 'r1',
        },
      ],
      annotations: {},
      orderOverrides: [],
      onAnnotate: () => undefined,
      onReorder: () => undefined,
    }),
  )

  assert.match(html, /aria-label="Option A, correct answer"/)
  assert.match(html, /aria-label="Option B"/)
  assert.match(html, /alt="Mountain"/)
  assert.match(html, /language-python/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { areMcqSelectionsEqual, isSameAnswer } from './mcq.js'

void test('areMcqSelectionsEqual treats reordered multi-select answers as equal', () => {
  assert.equal(areMcqSelectionsEqual(['a', 'b'], ['b', 'a']), true)
})

void test('areMcqSelectionsEqual rejects duplicate or mismatched selections', () => {
  assert.equal(areMcqSelectionsEqual(['a', 'a'], ['a']), false)
  assert.equal(areMcqSelectionsEqual(['a', 'b'], ['a']), false)
  assert.equal(areMcqSelectionsEqual(['a', 'b'], ['a', 'a']), false)
})

// Moved here from client/student/QuestionView.tsx (Follow-up 12, PR #381) so
// the server's update-draft handler can compare draft content directly,
// without importing a client-only React component module.
void test('isSameAnswer treats null/free-response/multiple-choice answers by content, order-insensitively for MCQ', () => {
  assert.equal(isSameAnswer(null, null), true)
  assert.equal(isSameAnswer(null, { type: 'free-response', text: '' }), false)
  assert.equal(
    isSameAnswer({ type: 'free-response', text: 'hi' }, { type: 'free-response', text: 'hi' }),
    true,
  )
  assert.equal(
    isSameAnswer({ type: 'free-response', text: 'hi' }, { type: 'free-response', text: 'bye' }),
    false,
  )
  assert.equal(
    isSameAnswer(
      { type: 'free-response', text: 'hi' },
      { type: 'multiple-choice', selectedOptionIds: ['a'] },
    ),
    false,
  )
  assert.equal(
    isSameAnswer(
      { type: 'multiple-choice', selectedOptionIds: ['a', 'b'] },
      { type: 'multiple-choice', selectedOptionIds: ['b', 'a'] },
    ),
    true,
  )
  assert.equal(
    isSameAnswer(
      { type: 'multiple-choice', selectedOptionIds: ['a'] },
      { type: 'multiple-choice', selectedOptionIds: ['a', 'b'] },
    ),
    false,
  )
})

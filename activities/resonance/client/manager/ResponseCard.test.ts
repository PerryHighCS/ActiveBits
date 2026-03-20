import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ResponseCard from './ResponseCard.js'

;(globalThis as { React?: typeof React }).React = React

void test('ResponseCard renders drag, star, flag, and emoji controls in the leading action stack order', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ResponseCard, {
      response: {
        id: 'resp-1',
        questionId: 'q-1',
        studentId: 'student-1',
        studentName: 'Taylor',
        submittedAt: Date.now(),
        answer: { type: 'free-response', text: 'Because it fits the pattern.' },
      },
      annotation: { starred: true, flagged: false, emoji: '🔥' },
      answerText: 'Because it fits the pattern.',
      onAnnotate: () => undefined,
      onShare: () => undefined,
      draggable: true,
      onMoveUp: () => undefined,
    }),
  )

  const leadingActionOrder = [
    'aria-label="Drag to reorder response from Taylor"',
    'aria-label="Unstar response"',
    'aria-label="Flag response"',
    'aria-label="Add emoji annotation"',
  ]

  let previousIndex = -1
  for (const marker of leadingActionOrder) {
    const markerIndex = markup.indexOf(marker)
    assert.notEqual(markerIndex, -1, `Expected ${marker} in rendered response card`)
    assert.ok(markerIndex > previousIndex, `Expected ${marker} after prior leading action control`)
    previousIndex = markerIndex
  }

  const answerIndex = markup.indexOf('Because it fits the pattern.')
  const shareIndex = markup.indexOf('aria-label="Share response from Taylor"')
  assert.notEqual(answerIndex, -1, 'Expected answer text in rendered response card')
  assert.notEqual(shareIndex, -1, 'Expected share button in rendered response card')
  assert.ok(shareIndex > answerIndex, 'Expected share button to render after the response content on the right side')
  assert.ok(
    markup.includes('self-stretch cursor-grab'),
    'Expected drag handle to render as a full-height leading handle',
  )
})

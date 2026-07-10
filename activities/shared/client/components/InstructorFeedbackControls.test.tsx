import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import InstructorFeedbackControls from './InstructorFeedbackControls.js'

;(globalThis as { React?: typeof React }).React = React

void test('InstructorFeedbackControls renders star, flag, and emoji controls in stack order', () => {
  const markup = renderToStaticMarkup(
    React.createElement(InstructorFeedbackControls, {
      annotation: { starred: true, flagged: false, emoji: '🔥' },
      emojiOptions: [{ emoji: '🔥', label: 'On fire' }],
      onToggleStar: () => undefined,
      onToggleFlag: () => undefined,
      onEmojiChange: () => undefined,
    }),
  )

  const actionOrder = [
    'aria-label="Unstar response"',
    'aria-label="Flag response"',
    'aria-label="Add emoji annotation"',
  ]

  let previousIndex = -1
  for (const marker of actionOrder) {
    const markerIndex = markup.indexOf(marker)
    assert.notEqual(markerIndex, -1, `Expected ${marker} in rendered feedback controls`)
    assert.ok(markerIndex > previousIndex, `Expected ${marker} after prior feedback control`)
    previousIndex = markerIndex
  }
})

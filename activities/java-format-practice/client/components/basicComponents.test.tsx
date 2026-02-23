import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ChallengeQuestion from './ChallengeQuestion'
import ChallengeSelector from './ChallengeSelector'
import StatsPanel from './StatsPanel'
import FormatReferenceModal from './ReferenceModal'

void test('ChallengeQuestion renders prompt and invalid fallback', () => {
  const validMarkup = renderToStaticMarkup(React.createElement(ChallengeQuestion, { prompt: 'Explain %d' }))
  assert.match(validMarkup, /Explain %d/)

  const invalidMarkup = renderToStaticMarkup(React.createElement(ChallengeQuestion, { prompt: null }))
  assert.match(invalidMarkup, /Invalid question/)

  const emptyMarkup = renderToStaticMarkup(React.createElement(ChallengeQuestion, { prompt: '   ' }))
  assert.match(emptyMarkup, /Invalid question/)
})

void test('ChallengeSelector renders difficulty/theme controls with selected state', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ChallengeSelector, {
      currentDifficulty: 'advanced',
      currentTheme: 'spy-badge',
      onDifficultyChange: () => {},
      onThemeChange: () => {},
      isDisabled: false,
    }),
  )

  assert.match(markup, /Difficulty:/)
  assert.match(markup, /Theme:/)
  assert.match(markup, /Advanced/)
  assert.match(markup, /Spy Badge/)
})

void test('StatsPanel computes and renders accuracy', () => {
  const markup = renderToStaticMarkup(
    React.createElement(StatsPanel, {
      stats: {
        total: 12,
        correct: 9,
        streak: 3,
        longestStreak: 5,
      },
    }),
  )

  assert.match(markup, /Your Progress/)
  assert.match(markup, /75%/)
})

void test('FormatReferenceModal renders sections only when open', () => {
  const closedMarkup = renderToStaticMarkup(
    React.createElement(FormatReferenceModal, {
      isOpen: false,
      onClose: () => {},
      referenceData: null,
    }),
  )
  assert.equal(closedMarkup, '')

  const openMarkup = renderToStaticMarkup(
    React.createElement(FormatReferenceModal, {
      isOpen: true,
      onClose: () => {},
      referenceData: {
        title: 'Formatter Reference',
        sections: [
          {
            id: 'table-1',
            type: 'table',
            title: 'Specifiers',
            columns: ['Specifier', 'Type'],
            rows: [['%s', 'String']],
          },
          {
            id: 'list-1',
            type: 'list',
            title: 'Tips',
            items: [{ code: '%n', text: 'New line' }],
          },
        ],
      },
    }),
  )

  assert.match(openMarkup, /Formatter Reference/)
  assert.match(openMarkup, /Specifiers/)
  assert.match(openMarkup, /Tips/)
  assert.match(openMarkup, /<th[^>]*scope="col"[^>]*>Specifier<\/th>/)
  assert.match(openMarkup, /<th[^>]*scope="col"[^>]*>Type<\/th>/)
})

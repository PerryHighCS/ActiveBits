import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Leaderboard from './Leaderboard'

void test('Leaderboard renders empty copy when no entries', () => {
  const html = renderToStaticMarkup(React.createElement(Leaderboard, { entries: [] }))
  assert.match(html, /No solutions yet/)
})

void test('Leaderboard renders row, badges, and action buttons', () => {
  const html = renderToStaticMarkup(
    React.createElement(Leaderboard, {
      entries: [
        {
          id: 'bruteforce',
          name: 'Brute Force (Optimal)',
          distance: 12.3,
          timeToComplete: null,
          progressCurrent: 10,
          progressTotal: 20,
          type: 'bruteforce',
          complete: false,
        },
      ],
      onHighlight: () => {},
      onToggleBroadcast: () => {},
      broadcastIds: ['bruteforce'],
    }),
  )

  assert.match(html, /Brute Force \(Optimal\)/)
  assert.match(html, /btn-view/)
  assert.match(html, /btn-broadcast active/)
  assert.match(html, /10\/20/)
})

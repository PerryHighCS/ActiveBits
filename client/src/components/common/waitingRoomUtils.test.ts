import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPersistentSessionWsUrl,
  getWaiterMessage,
  isWaitingRoomMessage,
  parseWaitingRoomMessage,
} from './waitingRoomUtils'

test('getWaiterMessage formats waiting count copy', () => {
  assert.equal(getWaiterMessage(0), 'You are the first one here!')
  assert.equal(getWaiterMessage(1), 'You are the first one here!')
  assert.equal(getWaiterMessage(2), 'You and 1 other person waiting')
  assert.equal(getWaiterMessage(5), 'You and 4 others waiting')
})

test('buildPersistentSessionWsUrl switches protocol and includes params', () => {
  const wsUrl = buildPersistentSessionWsUrl(
    { protocol: 'http:', host: 'localhost:3000', search: '', href: 'http://localhost:3000' },
    'abc123',
    'gallery-walk',
  )
  assert.equal(
    wsUrl,
    'ws://localhost:3000/ws/persistent-session?hash=abc123&activityName=gallery-walk',
  )

  const secureUrl = buildPersistentSessionWsUrl(
    { protocol: 'https:', host: 'bits.example', search: '', href: 'https://bits.example' },
    'xyz',
    'raffle',
  )
  assert.equal(
    secureUrl,
    'wss://bits.example/ws/persistent-session?hash=xyz&activityName=raffle',
  )
})

test('parseWaitingRoomMessage parses valid JSON and returns null for malformed payloads', () => {
  assert.deepEqual(parseWaitingRoomMessage('{"type":"waiter-count","count":3}'), {
    type: 'waiter-count',
    count: 3,
  })
  assert.equal(parseWaitingRoomMessage('not-json'), null)
})

test('isWaitingRoomMessage validates supported message shapes', () => {
  assert.equal(isWaitingRoomMessage({ type: 'waiter-count', count: 3 }), true)
  assert.equal(isWaitingRoomMessage({ type: 'teacher-authenticated', sessionId: 's1' }), true)
  assert.equal(isWaitingRoomMessage({ type: 'teacher-code-error', error: 'bad code' }), true)
  assert.equal(isWaitingRoomMessage({ type: 'waiter-count', count: '3' }), false)
  assert.equal(isWaitingRoomMessage({ type: 'unknown', anything: true }), false)
})

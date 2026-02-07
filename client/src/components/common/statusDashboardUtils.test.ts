import test from 'node:test'
import assert from 'node:assert/strict'
import { buildByTypeEntries, buildSessionRows, fmtBytes, fmtInt } from './statusDashboardUtils'

test('fmtInt returns fallback for non-finite values', () => {
  assert.equal(fmtInt(42), '42')
  assert.equal(fmtInt(Number.NaN), '-')
  assert.equal(fmtInt(undefined), '-')
})

test('fmtBytes formats byte values with unit scaling', () => {
  assert.equal(fmtBytes(0), '0.0 B')
  assert.equal(fmtBytes(1024), '1.0 KB')
  assert.equal(fmtBytes(1536), '1.5 KB')
  assert.equal(fmtBytes(Number.NaN), '-')
})

test('buildByTypeEntries returns all activity ids with stable sorting and zero defaults', () => {
  const entries = buildByTypeEntries(['www-sim', 'raffle', 'gallery-walk'], {
    raffle: 3,
    'gallery-walk': 1,
  })

  assert.deepEqual(entries, [
    ['gallery-walk', 1],
    ['raffle', 3],
    ['www-sim', 0],
  ])
})

test('buildSessionRows sorts by lastActivity and maps defaults', () => {
  const rows = buildSessionRows([
    {
      id: 'older',
      lastActivity: '2024-01-01T00:00:00.000Z',
      ttlRemainingMs: 900,
      approxBytes: 110,
    },
    {
      id: 'newer',
      type: 'raffle',
      socketCount: 2,
      lastActivity: '2024-01-02T00:00:00.000Z',
      expiresAt: '2024-01-02T01:00:00.000Z',
      ttlRemainingMs: 5500,
      approxBytes: 220,
    },
  ])

  assert.equal(rows[0]?.id, 'newer')
  assert.equal(rows[0]?.ttl, '5s')
  assert.equal(rows[0]?.type, 'raffle')
  assert.equal(rows[1]?.id, 'older')
  assert.equal(rows[1]?.type, '-')
  assert.equal(rows[1]?.socketCount, 0)
  assert.equal(rows[1]?.expiresAt, '-')
  assert.equal(rows[1]?.ttl, '0s')
})

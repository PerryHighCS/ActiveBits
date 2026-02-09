import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPersistentSessionKey,
  buildQueryString,
  buildSoloLink,
  describeSelectedOptions,
  initializeDeepLinkOptions,
  normalizeSelectedOptions,
  parseDeepLinkOptions,
} from './manageDashboardUtils'

const rawOptions = {
  algorithm: {
    label: 'Algorithm',
    type: 'select',
    options: [
      { value: '', label: 'None' },
      { value: 'merge-sort', label: 'Merge Sort' },
    ],
  },
  challenge: {
    label: 'Challenge',
    type: 'text',
  },
}

void test('parseDeepLinkOptions keeps supported option metadata', () => {
  const parsed = parseDeepLinkOptions(rawOptions)

  assert.equal(parsed.algorithm?.label, 'Algorithm')
  assert.equal(parsed.algorithm?.type, 'select')
  assert.deepEqual(parsed.algorithm?.options?.[1], { value: 'merge-sort', label: 'Merge Sort' })
  assert.equal(parsed.challenge?.type, 'text')
})

void test('initializeDeepLinkOptions and normalizeSelectedOptions respect allowed keys', () => {
  assert.deepEqual(initializeDeepLinkOptions(rawOptions), {
    algorithm: '',
    challenge: '',
  })

  const normalized = normalizeSelectedOptions(rawOptions, {
    algorithm: 'merge-sort',
    challenge: '',
    ignored: 'value',
  })

  assert.deepEqual(normalized, {
    algorithm: 'merge-sort',
  })
})

void test('buildQueryString and buildSoloLink include only non-empty params', () => {
  assert.equal(buildQueryString({ algorithm: 'merge-sort', challenge: '' }), '?algorithm=merge-sort')
  assert.equal(buildSoloLink('https://bits.example', 'algorithm-demo', { algorithm: 'merge-sort' }), 'https://bits.example/solo/algorithm-demo?algorithm=merge-sort')
})

void test('describeSelectedOptions maps option labels and falls back to raw values', () => {
  const descriptions = describeSelectedOptions(rawOptions, {
    algorithm: 'merge-sort',
    challenge: 'arrays',
  })

  assert.deepEqual(descriptions, ['Algorithm: Merge Sort', 'Challenge: arrays'])
})

void test('buildPersistentSessionKey creates stable map keys', () => {
  assert.equal(buildPersistentSessionKey('raffle', 'abc123'), 'raffle:abc123')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPersistentLinkUrl,
  buildPersistentSessionKey,
  buildQueryString,
  buildSoloLink,
  describeSelectedOptions,
  initializeDeepLinkOptions,
  normalizeSelectedOptions,
  parseDeepLinkGenerator,
  parseDeepLinkOptions,
  validateDeepLinkSelection,
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
  presentationUrl: {
    label: 'Presentation URL',
    type: 'text',
    validator: 'url',
  },
}

void test('parseDeepLinkOptions keeps supported option metadata', () => {
  const parsed = parseDeepLinkOptions(rawOptions)

  assert.equal(parsed.algorithm?.label, 'Algorithm')
  assert.equal(parsed.algorithm?.type, 'select')
  assert.deepEqual(parsed.algorithm?.options?.[1], { value: 'merge-sort', label: 'Merge Sort' })
  assert.equal(parsed.challenge?.type, 'text')
  assert.equal(parsed.presentationUrl?.validator, 'url')
})

void test('initializeDeepLinkOptions and normalizeSelectedOptions respect allowed keys', () => {
  assert.deepEqual(initializeDeepLinkOptions(rawOptions), {
    algorithm: '',
    challenge: '',
    presentationUrl: '',
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

void test('validateDeepLinkSelection enforces URL validator options', () => {
  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: '' }), {
    presentationUrl: 'Presentation URL is required',
  })

  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: 'javascript:alert(1)' }), {
    presentationUrl: 'Presentation URL must be a valid http(s) URL',
  })

  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: 'https://slides.example.com/deck' }), {})
})

void test('buildPersistentSessionKey creates stable map keys', () => {
  assert.equal(buildPersistentSessionKey('raffle', 'abc123'), 'raffle:abc123')
})

void test('parseDeepLinkGenerator validates and normalizes generator metadata', () => {
  assert.equal(parseDeepLinkGenerator(null), null)
  assert.equal(parseDeepLinkGenerator({ endpoint: '' }), null)

  assert.deepEqual(parseDeepLinkGenerator({ endpoint: '/api/syncdeck/generate-url' }), {
    endpoint: '/api/syncdeck/generate-url',
    mode: 'replace-url',
    expectsSelectedOptions: true,
  })

  assert.deepEqual(parseDeepLinkGenerator({ endpoint: '/api/custom', mode: 'append-query', expectsSelectedOptions: false }), {
    endpoint: '/api/custom',
    mode: 'append-query',
    expectsSelectedOptions: false,
  })
})

void test('buildPersistentLinkUrl appends query only for legacy or append-query mode', () => {
  assert.equal(
    buildPersistentLinkUrl('https://bits.example', '/activity/raffle/hash1', { topic: 'arrays' }, null),
    'https://bits.example/activity/raffle/hash1?topic=arrays',
  )

  assert.equal(
    buildPersistentLinkUrl(
      'https://bits.example',
      '/activity/syncdeck/hash2?presentationUrl=https%3A%2F%2Fslides.example&urlHash=abcd',
      { presentationUrl: 'https://tamper.example' },
      { endpoint: '/api/syncdeck/generate-url', mode: 'replace-url', expectsSelectedOptions: true },
    ),
    'https://bits.example/activity/syncdeck/hash2?presentationUrl=https%3A%2F%2Fslides.example&urlHash=abcd',
  )
})

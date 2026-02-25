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
  parseCreateSessionBootstrap,
  parseDeepLinkGenerator,
  persistCreateSessionBootstrapToSessionStorage,
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

void test('normalizeSelectedOptions trims text/url values and keeps select values as-is', () => {
  const normalized = normalizeSelectedOptions(rawOptions, {
    algorithm: ' merge-sort ',
    challenge: '  arrays  ',
    presentationUrl: '  https://slides.example.com/deck  ',
  })

  assert.deepEqual(normalized, {
    algorithm: ' merge-sort ',
    challenge: 'arrays',
    presentationUrl: 'https://slides.example.com/deck',
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
    preflight: null,
  })

  assert.deepEqual(parseDeepLinkGenerator({ endpoint: '/api/custom', mode: 'append-query', expectsSelectedOptions: false }), {
    endpoint: '/api/custom',
    mode: 'append-query',
    expectsSelectedOptions: false,
    preflight: null,
  })

  assert.deepEqual(
    parseDeepLinkGenerator({
      endpoint: '/api/syncdeck/generate-url',
      preflight: {
        type: 'reveal-sync-ping',
        optionKey: 'presentationUrl',
        timeoutMs: 5000,
      },
    }),
    {
      endpoint: '/api/syncdeck/generate-url',
      mode: 'replace-url',
      expectsSelectedOptions: true,
      preflight: {
        type: 'reveal-sync-ping',
        optionKey: 'presentationUrl',
        timeoutMs: 5000,
      },
    },
  )

  assert.deepEqual(
    parseDeepLinkGenerator({
      endpoint: '/api/syncdeck/generate-url',
      preflight: {
        type: 'reveal-sync-ping',
        optionKey: '',
      },
    }),
    {
      endpoint: '/api/syncdeck/generate-url',
      mode: 'replace-url',
      expectsSelectedOptions: true,
      preflight: null,
    },
  )
})

void test('parseDeepLinkGenerator ignores unknown generator properties', () => {
  assert.deepEqual(
    parseDeepLinkGenerator({
      endpoint: '/api/syncdeck/generate-url',
      unsupportedFlag: true,
    }),
    {
      endpoint: '/api/syncdeck/generate-url',
      mode: 'replace-url',
      expectsSelectedOptions: true,
      preflight: null,
    },
  )

  assert.deepEqual(
    parseDeepLinkGenerator({
      endpoint: '/api/syncdeck/generate-url',
      unsupportedFlag: true,
      preflight: {
        type: 'reveal-sync-ping',
        optionKey: 'deckUrl',
      },
    }),
    {
      endpoint: '/api/syncdeck/generate-url',
      mode: 'replace-url',
      expectsSelectedOptions: true,
      preflight: {
        type: 'reveal-sync-ping',
        optionKey: 'deckUrl',
        timeoutMs: 4000,
      },
    },
  )
})

void test('parseCreateSessionBootstrap validates sessionStorage bootstrap metadata', () => {
  assert.equal(parseCreateSessionBootstrap(null), null)

  assert.deepEqual(
    parseCreateSessionBootstrap({
      sessionStorage: [
        { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
        { keyPrefix: '  ', responseField: 'ignored' },
        { keyPrefix: 'x_', responseField: '' },
      ],
    }),
    {
      sessionStorage: [
        { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
      ],
    },
  )
})

void test('persistCreateSessionBootstrapToSessionStorage stores declared create response fields', () => {
  const originalWindow = globalThis.window
  const writes = new Map<string, string>()
  const fakeSessionStorage = {
    setItem(key: string, value: string) {
      writes.set(key, value)
    },
  }

  Object.defineProperty(globalThis, 'window', {
    value: { sessionStorage: fakeSessionStorage },
    configurable: true,
    writable: true,
  })

  try {
    persistCreateSessionBootstrapToSessionStorage(
      {
        sessionStorage: [
          { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
          { keyPrefix: 'x_', responseField: 'missingField' },
        ],
      },
      'session-123',
      {
        id: 'session-123',
        instructorPasscode: 'teacher-passcode',
      },
    )

    assert.deepEqual(Array.from(writes.entries()), [['syncdeck_instructor_session-123', 'teacher-passcode']])
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('persistCreateSessionBootstrapToSessionStorage ignores sessionStorage write failures', () => {
  const originalWindow = globalThis.window
  const originalWarn = console.warn
  const warnings: string[] = []
  let writeAttempts = 0
  const fakeSessionStorage = {
    setItem() {
      writeAttempts += 1
      throw new Error('quota exceeded')
    },
  }

  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  }

  Object.defineProperty(globalThis, 'window', {
    value: { sessionStorage: fakeSessionStorage },
    configurable: true,
    writable: true,
  })

  try {
    persistCreateSessionBootstrapToSessionStorage(
      {
        sessionStorage: [
          { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
        ],
      },
      'session-123',
      {
        instructorPasscode: 'teacher-passcode',
      },
    )

    assert.equal(writeAttempts, 1)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /\[ManageDashboard\] Failed to persist create-session bootstrap data to sessionStorage:/)
    assert.match(warnings[0] ?? '', /quota exceeded/)
  } finally {
    console.warn = originalWarn
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
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
      {
        endpoint: '/api/syncdeck/generate-url',
        mode: 'replace-url',
        expectsSelectedOptions: true,
        preflight: null,
      },
    ),
    'https://bits.example/activity/syncdeck/hash2?presentationUrl=https%3A%2F%2Fslides.example&urlHash=abcd',
  )
})

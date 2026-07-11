import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPersistentLinkRequestBody,
  buildCreateSessionBootstrapHistoryState,
  buildPersistentLinkUrl,
  buildManageDashboardUtilityUrl,
  buildPersistentSessionKey,
  buildQueryString,
  buildSoloLink,
  consumeCreateSessionBootstrapPayload,
  describeSelectedOptions,
  filterPersistentEntryPolicyOptionsForActivity,
  initializeDeepLinkOptions,
  hasSensitiveCreateSessionBootstrapPayload,
  normalizePersistentEntryPolicyForActivity,
  normalizeMultiselectValue,
  normalizeSelectedOptions,
  parseCreateSessionBootstrap,
  parseDeepLinkGenerator,
  persistCreateSessionBootstrapToSessionStorage,
  parseMultiselectValues,
  parseDeepLinkOptions,
  readCreateSessionBootstrapPayload,
  storeCreateSessionBootstrapPayload,
  validateDeepLinkSelection,
} from './manageDashboardUtils'

function createFakeSessionStorage(initialEntries?: Iterable<readonly [string, string]>) {
  const writes = new Map<string, string>(initialEntries)

  return {
    backing: writes,
    storage: {
      get length() {
        return writes.size
      },
      key(index: number) {
        return Array.from(writes.keys())[index] ?? null
      },
      getItem(key: string) {
        return writes.get(key) ?? null
      },
      setItem(key: string, value: string) {
        writes.set(key, value)
      },
      removeItem(key: string) {
        writes.delete(key)
      },
    },
  }
}

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
  missionLength: {
    label: 'Systems per mission',
    type: 'number',
    defaultValue: 5,
    min: 3,
    max: 12,
    step: 1,
  },
  hintsEnabled: {
    label: 'Hints available',
    type: 'checkbox',
    defaultValue: true,
  },
  challengeTypes: {
    label: 'Challenge types',
    type: 'multiselect',
    defaultValue: ['binary-to-decimal', 'decimal-to-binary'],
    options: [
      { value: 'binary-to-decimal', label: 'Binary to decimal' },
      { value: 'decimal-to-binary', label: 'Decimal to binary' },
      { value: 'compare-binary', label: 'Compare binary' },
    ],
  },
}

void test('parseDeepLinkOptions keeps supported option metadata', () => {
  const parsed = parseDeepLinkOptions(rawOptions)

  assert.equal(parsed.algorithm?.label, 'Algorithm')
  assert.equal(parsed.algorithm?.type, 'select')
  assert.deepEqual(parsed.algorithm?.options?.[1], { value: 'merge-sort', label: 'Merge Sort' })
  assert.equal(parsed.challenge?.type, 'text')
  assert.equal(parsed.presentationUrl?.validator, 'url')
  assert.equal(parsed.missionLength?.type, 'number')
  assert.equal(parsed.missionLength?.min, 3)
  assert.equal(parsed.hintsEnabled?.type, 'checkbox')
  assert.equal(parsed.hintsEnabled?.defaultValue, true)
  assert.equal(parsed.challengeTypes?.type, 'multiselect')

  const nonPositiveStep = parseDeepLinkOptions({
    count: {
      type: 'number',
      step: 0,
    },
  })
  assert.equal(nonPositiveStep.count?.step, undefined)
})

void test('initializeDeepLinkOptions and normalizeSelectedOptions respect allowed keys', () => {
  assert.deepEqual(initializeDeepLinkOptions(rawOptions), {
    algorithm: '',
    challenge: '',
    presentationUrl: '',
    missionLength: '5',
    hintsEnabled: 'true',
    challengeTypes: 'binary-to-decimal,decimal-to-binary',
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

void test('normalizeSelectedOptions trims text/url/number values and keeps select values as-is', () => {
  const normalized = normalizeSelectedOptions(rawOptions, {
    algorithm: ' merge-sort ',
    challenge: '  arrays  ',
    presentationUrl: '  https://slides.example.com/deck  ',
    missionLength: ' 7 ',
  })

  assert.deepEqual(normalized, {
    algorithm: ' merge-sort ',
    challenge: 'arrays',
    presentationUrl: 'https://slides.example.com/deck',
    missionLength: '7',
  })
})

void test('normalizeSelectedOptions serializes common checkbox and multiselect controls', () => {
  assert.deepEqual(normalizeSelectedOptions(rawOptions, {
    hintsEnabled: false,
    challengeTypes: ['compare-binary', 'bogus', 'decimal-to-binary', 'compare-binary'],
  }), {
    hintsEnabled: 'false',
    challengeTypes: 'compare-binary,decimal-to-binary',
  })
})

void test('parseMultiselectValues trims comma-separated selections', () => {
  assert.deepEqual(parseMultiselectValues('binary-to-decimal, decimal-to-binary,  compare-binary '), [
    'binary-to-decimal',
    'decimal-to-binary',
    'compare-binary',
  ])
})

void test('normalizeMultiselectValue removes duplicate and unsupported selections', () => {
  const parsedOptions = parseDeepLinkOptions(rawOptions)
  assert.equal(
    normalizeMultiselectValue('binary-to-decimal, missing-bit, decimal-to-binary, binary-to-decimal', parsedOptions.challengeTypes ?? {}),
    'binary-to-decimal,decimal-to-binary',
  )
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

void test('validateDeepLinkSelection enforces number ranges and multiselect choices', () => {
  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: 'https://slides.example', missionLength: '2' }), {
    missionLength: 'Systems per mission must be at least 3',
  })

  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: 'https://slides.example', missionLength: '13' }), {
    missionLength: 'Systems per mission must be at most 12',
  })

  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: 'https://slides.example', missionLength: 'five' }), {
    missionLength: 'Systems per mission must be a number',
  })

  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: 'https://slides.example', missionLength: '7.5' }), {
    missionLength: 'Systems per mission must align to increments of 1',
  })

  assert.deepEqual(validateDeepLinkSelection(rawOptions, { presentationUrl: 'https://slides.example', challengeTypes: 'binary-to-decimal,missing-bit' }), {
    challengeTypes: 'Challenge types contains an unsupported option',
  })
})

void test('buildPersistentSessionKey creates stable map keys', () => {
  assert.equal(buildPersistentSessionKey('raffle', 'abc123'), 'raffle:abc123')
})

void test('buildPersistentLinkRequestBody includes normalized teacher code for creates', () => {
  assert.deepEqual(
    buildPersistentLinkRequestBody({
      activityId: 'video-sync',
      teacherCode: ' teacher-code ',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
      entryPolicy: 'instructor-required',
    }),
    {
      activityName: 'video-sync',
      teacherCode: 'teacher-code',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
      entryPolicy: 'instructor-required',
    },
  )
})

void test('buildPersistentLinkRequestBody includes hash and teacher code for edits', () => {
  assert.deepEqual(
    buildPersistentLinkRequestBody({
      activityId: 'algorithm-demo',
      hash: 'abc123',
      teacherCode: ' updated-code ',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
      entryPolicy: 'solo-allowed',
    }),
    {
      activityName: 'algorithm-demo',
      hash: 'abc123',
      teacherCode: 'updated-code',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
      entryPolicy: 'solo-allowed',
    },
  )
})

void test('buildManageDashboardUtilityUrl normalizes relative utility paths and preserves absolute URLs', () => {
  assert.equal(
    buildManageDashboardUtilityUrl('https://bits.example', '/util/gallery-walk/viewer'),
    'https://bits.example/util/gallery-walk/viewer',
  )
  assert.equal(
    buildManageDashboardUtilityUrl('https://bits.example', 'util/gallery-walk/viewer'),
    'https://bits.example/util/gallery-walk/viewer',
  )
  assert.equal(
    buildManageDashboardUtilityUrl('https://bits.example', 'https://docs.example/guide'),
    'https://docs.example/guide',
  )
})

void test('filterPersistentEntryPolicyOptionsForActivity keeps only live-only for non-solo activities', () => {
  const options = [
    { value: 'instructor-required', label: 'Live Only', description: 'wait' },
    { value: 'solo-allowed', label: 'Live Or Solo', description: 'mixed' },
    { value: 'solo-only', label: 'Solo Only', description: 'solo' },
  ] as const

  assert.deepEqual(filterPersistentEntryPolicyOptionsForActivity(options, false), [options[0]])
  assert.deepEqual(filterPersistentEntryPolicyOptionsForActivity(options, true), [...options])
})

void test('normalizePersistentEntryPolicyForActivity falls back to live-only when solo is unsupported', () => {
  assert.equal(normalizePersistentEntryPolicyForActivity('solo-only', false), 'instructor-required')
  assert.equal(normalizePersistentEntryPolicyForActivity('solo-allowed', false), 'instructor-required')
  assert.equal(normalizePersistentEntryPolicyForActivity('instructor-required', false), 'instructor-required')
  assert.equal(normalizePersistentEntryPolicyForActivity('solo-only', true), 'solo-only')
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
      historyState: [' instructorPasscode ', '', 42],
    }),
    {
      sessionStorage: [
        { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
      ],
      historyState: ['instructorPasscode'],
    },
  )
})

void test('hasSensitiveCreateSessionBootstrapPayload detects credential-like fields', () => {
  assert.equal(hasSensitiveCreateSessionBootstrapPayload({ instructorPasscode: 'teacher-passcode' }), true)
  assert.equal(hasSensitiveCreateSessionBootstrapPayload({ managerCredential: 'secret' }), true)
  assert.equal(hasSensitiveCreateSessionBootstrapPayload({ studentId: 'student-1' }), false)
})

void test('persistCreateSessionBootstrapToSessionStorage stores declared non-sensitive create response fields', () => {
  const originalWindow = globalThis.window
  const { backing: writes, storage: fakeSessionStorage } = createFakeSessionStorage()

  Object.defineProperty(globalThis, 'window', {
    value: { sessionStorage: fakeSessionStorage },
    configurable: true,
    writable: true,
  })

  try {
    persistCreateSessionBootstrapToSessionStorage(
      {
        sessionStorage: [
          { keyPrefix: 'student_', responseField: 'studentId' },
          { keyPrefix: 'x_', responseField: 'missingField' },
        ],
      },
      'session-123',
      {
        id: 'session-123',
        studentId: 'student-1',
      },
    )

    assert.deepEqual(Array.from(writes.entries()), [['student_session-123', 'student-1']])
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('persistCreateSessionBootstrapToSessionStorage skips sensitive declared create response fields', () => {
  const originalWindow = globalThis.window
  const { backing: writes, storage: fakeSessionStorage } = createFakeSessionStorage()

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
          { keyPrefix: 'student_', responseField: 'studentId' },
        ],
      },
      'session-123',
      {
        id: 'session-123',
        instructorPasscode: 'teacher-passcode',
        studentId: 'student-1',
      },
    )

    assert.deepEqual(Array.from(writes.entries()), [['student_session-123', 'student-1']])
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('persistCreateSessionBootstrapToSessionStorage ignores non-sensitive sessionStorage write failures', () => {
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
          { keyPrefix: 'student_', responseField: 'studentId' },
        ],
      },
      'session-123',
      {
        studentId: 'student-1',
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

void test('storeCreateSessionBootstrapPayload keeps a same-tab bootstrap payload until first consume', () => {
  const originalWindow = globalThis.window
  const { backing: sessionStorage, storage: fakeSessionStorage } = createFakeSessionStorage()

  Object.defineProperty(globalThis, 'window', {
    value: { sessionStorage: fakeSessionStorage },
    configurable: true,
    writable: true,
  })

  try {
    storeCreateSessionBootstrapPayload('video-sync', 'session-123', {
      id: 'session-123',
      instructorPasscode: 'teacher-passcode',
    })

    assert.equal(sessionStorage.size, 0)
    assert.deepEqual(
      consumeCreateSessionBootstrapPayload('video-sync', 'session-123'),
      {
        id: 'session-123',
        instructorPasscode: 'teacher-passcode',
      },
    )
    assert.equal(consumeCreateSessionBootstrapPayload('video-sync', 'session-123'), null)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('consumeCreateSessionBootstrapPayload clears sessionStorage even when the same-tab cache entry exists', () => {
  const originalWindow = globalThis.window
  const { backing: sessionStorage, storage: fakeSessionStorage } = createFakeSessionStorage()

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    storeCreateSessionBootstrapPayload('video-sync', 'session-123', {
      id: 'session-123',
      studentId: 'student-1',
    }, 10)

    assert.equal(
      sessionStorage.has('create-session-bootstrap:video-sync:session-123'),
      true,
    )

    assert.deepEqual(
      consumeCreateSessionBootstrapPayload('video-sync', 'session-123', 10),
      {
        id: 'session-123',
        studentId: 'student-1',
      },
    )

    assert.equal(
      sessionStorage.get('create-session-bootstrap:video-sync:session-123') ?? null,
      null,
    )
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('readCreateSessionBootstrapPayload leaves iframe bootstrap storage available until explicit consume', () => {
  const originalWindow = globalThis.window
  const { backing: sessionStorage, storage: fakeSessionStorage } = createFakeSessionStorage()

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    sessionStorage.set(
      'create-session-bootstrap:video-sync:session-iframe',
      JSON.stringify({
        createdAtMs: 10,
        payload: {
          instructorPasscode: 'teacher-passcode',
        },
      }),
    )

    assert.deepEqual(
      readCreateSessionBootstrapPayload('video-sync', 'session-iframe', 10),
      {
        instructorPasscode: 'teacher-passcode',
      },
    )
    assert.equal(
      sessionStorage.has('create-session-bootstrap:video-sync:session-iframe'),
      true,
    )
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('consumeCreateSessionBootstrapPayload falls back to sessionStorage for iframe/bootstrap reload contexts', () => {
  const originalWindow = globalThis.window
  const { backing: sessionStorage, storage: fakeSessionStorage } = createFakeSessionStorage()

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    sessionStorage.set(
      'create-session-bootstrap:video-sync:session-iframe',
      JSON.stringify({
        createdAtMs: 10,
        payload: {
          instructorPasscode: 'teacher-passcode',
        },
      }),
    )

    assert.deepEqual(
      consumeCreateSessionBootstrapPayload('video-sync', 'session-iframe', 10),
      {
        instructorPasscode: 'teacher-passcode',
      },
    )

    assert.equal(
      sessionStorage.get('create-session-bootstrap:video-sync:session-iframe') ?? null,
      null,
    )
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('consumeCreateSessionBootstrapPayload tolerates sessionStorage removeItem failures', () => {
  const originalWindow = globalThis.window
  const storageEntries = new Map<string, string>([
    [
      'create-session-bootstrap:video-sync:session-iframe',
      JSON.stringify({
        createdAtMs: 10,
        payload: {
          instructorPasscode: 'teacher-passcode',
        },
      }),
    ],
    [
      'create-session-bootstrap:video-sync:session-invalid',
      '{"createdAtMs":"bad"}',
    ],
  ])

  const fakeSessionStorage = {
    getItem(key: string) {
      return storageEntries.get(key) ?? null
    },
    setItem(_key: string, _value: string) {
      throw new Error('[TEST] unexpected setItem')
    },
    removeItem(_key: string) {
      throw new Error('[TEST] removeItem unavailable')
    },
  }

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    assert.deepEqual(
      consumeCreateSessionBootstrapPayload('video-sync', 'session-iframe', 10),
      {
        instructorPasscode: 'teacher-passcode',
      },
    )

    assert.equal(
      consumeCreateSessionBootstrapPayload('video-sync', 'session-invalid', 10),
      null,
    )
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('consumeCreateSessionBootstrapPayload rejects array-shaped payload entries from sessionStorage', () => {
  const originalWindow = globalThis.window
  const { backing: sessionStorage, storage: fakeSessionStorage } = createFakeSessionStorage([
    [
      'create-session-bootstrap:video-sync:session-array-payload',
      JSON.stringify({
        createdAtMs: 10,
        payload: ['not', 'an', 'object'],
      }),
    ],
  ])

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    assert.equal(
      consumeCreateSessionBootstrapPayload('video-sync', 'session-array-payload', 10),
      null,
    )
    assert.equal(
      sessionStorage.get('create-session-bootstrap:video-sync:session-array-payload') ?? null,
      null,
    )
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('storeCreateSessionBootstrapPayload expires abandoned same-tab payloads after a short TTL', () => {
  const createdAtMs = 1_000

  storeCreateSessionBootstrapPayload(
    'video-sync',
    'session-expiring',
    {
      id: 'session-expiring',
      instructorPasscode: 'teacher-passcode',
    },
    createdAtMs,
  )

  assert.equal(
    consumeCreateSessionBootstrapPayload('video-sync', 'session-expiring', createdAtMs + 5 * 60 * 1000 + 1),
    null,
  )
})

void test('consumeCreateSessionBootstrapPayload prunes expired sessionStorage bootstrap payloads', () => {
  const originalWindow = globalThis.window
  const { backing: sessionStorage, storage: fakeSessionStorage } = createFakeSessionStorage([
    [
      'create-session-bootstrap:video-sync:session-expired',
      JSON.stringify({
        createdAtMs: 1_000,
        payload: {
          instructorPasscode: 'expired-passcode',
        },
      }),
    ],
    [
      'unrelated-key',
      'preserve-me',
    ],
  ])

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    assert.equal(
      consumeCreateSessionBootstrapPayload('video-sync', 'session-missing', 1_000 + 5 * 60 * 1000 + 1),
      null,
    )

    assert.equal(
      sessionStorage.has('create-session-bootstrap:video-sync:session-expired'),
      false,
    )
    assert.equal(sessionStorage.get('unrelated-key'), 'preserve-me')
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('consumeCreateSessionBootstrapPayload prunes unrelated expired entries without requiring a new write', () => {
  const createdAtMs = 2_000
  const expiredNowMs = createdAtMs + 5 * 60 * 1000 + 1

  storeCreateSessionBootstrapPayload(
    'video-sync',
    'session-expired-abandoned',
    {
      id: 'session-expired-abandoned',
      instructorPasscode: 'teacher-passcode-expired',
    },
    createdAtMs,
  )

  storeCreateSessionBootstrapPayload(
    'video-sync',
    'session-fresh',
    {
      id: 'session-fresh',
      instructorPasscode: 'teacher-passcode-fresh',
    },
    expiredNowMs,
  )

  assert.deepEqual(
    consumeCreateSessionBootstrapPayload('video-sync', 'session-fresh', expiredNowMs),
    {
      id: 'session-fresh',
      instructorPasscode: 'teacher-passcode-fresh',
    },
  )

  assert.equal(
    consumeCreateSessionBootstrapPayload('video-sync', 'session-expired-abandoned', expiredNowMs),
    null,
  )
})

void test('storeCreateSessionBootstrapPayload evicts oldest abandoned entries when the same-tab cache is full', () => {
  for (let index = 0; index <= 100; index += 1) {
    storeCreateSessionBootstrapPayload(
      'video-sync',
      `session-${index}`,
      {
        id: `session-${index}`,
        instructorPasscode: `teacher-passcode-${index}`,
      },
      index,
    )
  }

  assert.equal(consumeCreateSessionBootstrapPayload('video-sync', 'session-0', 101), null)
  assert.deepEqual(
    consumeCreateSessionBootstrapPayload('video-sync', 'session-100', 101),
    {
      id: 'session-100',
      instructorPasscode: 'teacher-passcode-100',
    },
  )

  for (let index = 1; index < 100; index += 1) {
    consumeCreateSessionBootstrapPayload('video-sync', `session-${index}`, 101)
  }
})

void test('storeCreateSessionBootstrapPayload evicts oldest sessionStorage bootstrap entries when the same-tab cache is full', () => {
  const originalWindow = globalThis.window
  const { backing: sessionStorage, storage: fakeSessionStorage } = createFakeSessionStorage()

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    for (let index = 0; index <= 100; index += 1) {
      storeCreateSessionBootstrapPayload(
        'video-sync',
        `stored-session-${index}`,
        {
          id: `stored-session-${index}`,
          studentId: `student-${index}`,
        },
        index,
      )
    }

    assert.equal(
      sessionStorage.has('create-session-bootstrap:video-sync:stored-session-0'),
      false,
    )
    assert.equal(
      sessionStorage.has('create-session-bootstrap:video-sync:stored-session-100'),
      true,
    )
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })

    for (let index = 0; index <= 100; index += 1) {
      consumeCreateSessionBootstrapPayload('video-sync', `stored-session-${index}`, 101)
    }
  }
})

void test('storeCreateSessionBootstrapPayload prunes stale sessionStorage entries when a write hits storage pressure', () => {
  const originalWindow = globalThis.window
  const staleCreatedAtMs = 1_000
  const freshNowMs = staleCreatedAtMs + 5 * 60 * 1000 + 1
  const staleKey = 'create-session-bootstrap:video-sync:stale-session'
  const freshKey = 'create-session-bootstrap:video-sync:fresh-session'
  const staleValue = JSON.stringify({
    createdAtMs: staleCreatedAtMs,
    payload: {
      studentId: 'stale-student',
    },
  })
  const writes = new Map<string, string>([[staleKey, staleValue]])
  let setAttempts = 0

  const fakeSessionStorage = {
    get length() {
      return writes.size
    },
    key(index: number) {
      return Array.from(writes.keys())[index] ?? null
    },
    getItem(key: string) {
      return writes.get(key) ?? null
    },
    setItem(key: string, value: string) {
      setAttempts += 1
      if (key === freshKey && writes.has(staleKey)) {
        throw new Error('quota exceeded')
      }
      writes.set(key, value)
    },
    removeItem(key: string) {
      writes.delete(key)
    },
  }

  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: fakeSessionStorage,
    },
    configurable: true,
    writable: true,
  })

  try {
    storeCreateSessionBootstrapPayload(
      'video-sync',
      'fresh-session',
      {
        id: 'fresh-session',
        studentId: 'fresh-student',
      },
      freshNowMs,
    )

    assert.equal(setAttempts, 2)
    assert.equal(writes.has(staleKey), false)
    assert.equal(writes.has(freshKey), true)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
  }
})

void test('buildCreateSessionBootstrapHistoryState keeps only declared history-state fields', () => {
  assert.deepEqual(
    buildCreateSessionBootstrapHistoryState(
      {
        historyState: ['instructorPasscode'],
        sessionStorage: [
          { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
        ],
      },
      {
        id: 'session-123',
        instructorPasscode: 'teacher-passcode',
        extraSecret: 'do-not-forward',
      },
    ),
    {
      instructorPasscode: 'teacher-passcode',
    },
  )

  assert.equal(
    buildCreateSessionBootstrapHistoryState(
      {
        sessionStorage: [
          { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
        ],
      },
      {
        id: 'session-123',
        instructorPasscode: 'teacher-passcode',
      },
    ),
    null,
  )

  const inheritedPayload = Object.create({ instructorPasscode: 'inherited-passcode' }) as Record<string, unknown>
  inheritedPayload.id = 'session-123'
  assert.equal(
    buildCreateSessionBootstrapHistoryState(
      {
        historyState: ['instructorPasscode'],
        sessionStorage: [
          { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
        ],
      },
      inheritedPayload,
    ),
    null,
  )

  assert.equal(
    buildCreateSessionBootstrapHistoryState(
      {
        historyState: ['instructorPasscode'],
        sessionStorage: [
          { keyPrefix: 'syncdeck_instructor_', responseField: 'instructorPasscode' },
        ],
      },
      {
        instructorPasscode: undefined,
      },
    ),
    null,
  )
})

void test('buildPersistentLinkUrl appends query only for legacy or append-query mode', () => {
  assert.equal(
    buildPersistentLinkUrl('https://bits.example', '/activity/raffle/hash1', { topic: 'arrays' }, null),
    'https://bits.example/activity/raffle/hash1?topic=arrays',
  )

  assert.equal(
    buildPersistentLinkUrl(
      'https://bits.example',
      '/activity/java-string-practice/hash3?entryPolicy=solo-allowed&urlHash=abcd1234abcd1234',
      { topic: 'arrays' },
      null,
    ),
    'https://bits.example/activity/java-string-practice/hash3?entryPolicy=solo-allowed&urlHash=abcd1234abcd1234&topic=arrays',
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

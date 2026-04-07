import assert from 'node:assert/strict'
import test from 'node:test'
import resonanceClientModule, { launchResonancePersistentSoloEntry } from './index.js'

void test('launchResonancePersistentSoloEntry creates a self-paced solo session from prepared selectedOptions', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ input: string; init?: RequestInit }> = []

  globalThis.fetch = (async (input, init) => {
    requests.push({ input: String(input), init })

    if (String(input) === '/api/resonance/create') {
      return {
        ok: true,
        json: async () => ({
          id: 'resonance-solo-1',
        }),
      } as Response
    }

    throw new Error(`[TEST] Unexpected fetch: ${String(input)}`)
  }) as typeof fetch

  try {
    const result = await launchResonancePersistentSoloEntry({
      hash: '',
      search: '',
      selectedOptions: {
        q: 'encoded-question-set',
        h: 'persistent-hash',
      },
    })

    assert.deepEqual(result, {
      sessionId: 'resonance-solo-1',
    })
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.input, '/api/resonance/create')
    assert.deepEqual(
      JSON.parse(String(requests[0]?.init?.body ?? '{}')),
      {
        encodedQuestions: 'encoded-question-set',
        persistentHash: 'persistent-hash',
        selfPacedMode: true,
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('launchResonancePersistentSoloEntry rejects launches without prepared selectedOptions', async () => {
  await assert.rejects(
    launchResonancePersistentSoloEntry({
      hash: '',
      search: '',
      selectedOptions: {},
    }),
    /valid question set/i,
  )
})

void test('resonance client module exports persistent solo launcher', () => {
  assert.equal(typeof resonanceClientModule.launchPersistentSoloEntry, 'function')
})

void test('launchResonancePersistentSoloEntry creates a self-paced solo session from raw question options', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ input: string; init?: RequestInit }> = []

  globalThis.fetch = (async (input, init) => {
    requests.push({ input: String(input), init })

    if (String(input) === '/api/resonance/create') {
      return {
        ok: true,
        json: async () => ({
          id: 'resonance-solo-raw-1',
        }),
      } as Response
    }

    throw new Error(`[TEST] Unexpected fetch: ${String(input)}`)
  }) as typeof fetch

  try {
    const result = await launchResonancePersistentSoloEntry({
      hash: '',
      search: '',
      selectedOptions: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What is still unclear?',
            order: 0,
          },
        ],
      },
    })

    assert.deepEqual(result, {
      sessionId: 'resonance-solo-raw-1',
    })
    assert.equal(requests.length, 1)
    assert.deepEqual(
      JSON.parse(String(requests[0]?.init?.body ?? '{}')),
      {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What is still unclear?',
            order: 0,
          },
        ],
        selfPacedMode: true,
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('launchResonancePersistentSoloEntry rejects raw question options when any question is invalid', async () => {
  const originalConsoleError = console.error
  const consoleErrors: unknown[][] = []
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args)
  }

  try {
    await assert.rejects(
      launchResonancePersistentSoloEntry({
        hash: '',
        search: '',
        selectedOptions: {
          questions: [
            {
              id: 'q1',
              type: 'free-response',
              text: 'Valid question',
              order: 0,
            },
            {
              id: 'q2',
              type: 'multiple-choice',
              text: 'Broken question',
              order: 1,
              options: [{ id: 'only', text: 'Only one option' }],
            },
          ],
        },
      }),
      /question "q2": multiple-choice must have at least 2 options/i,
    )

    assert.deepEqual(consoleErrors, [[
      '[Resonance][SoloLaunchInvalidQuestions]',
      {
        errors: ['question "q2": multiple-choice must have at least 2 options'],
        questionCount: 2,
      },
    ]])
  } finally {
    console.error = originalConsoleError
  }
})

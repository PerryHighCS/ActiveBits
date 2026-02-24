import assert from 'node:assert/strict'
import test from 'node:test'
import activityConfigSchema from '../types/activityConfigSchema.js'

const { parseActivityConfig } = activityConfigSchema

void test('parseActivityConfig accepts valid shared contracts', () => {
  const parsed = parseActivityConfig(
    {
      id: 'syncdeck',
      name: 'SyncDeck',
      description: 'desc',
      color: 'indigo',
      soloMode: false,
      deepLinkOptions: {
        presentationUrl: {
          label: 'Presentation URL',
          type: 'text',
          validator: 'url',
        },
      },
      deepLinkGenerator: {
        endpoint: '/api/syncdeck/generate-url',
        mode: 'replace-url',
        expectsSelectedOptions: true,
        preflight: {
          type: 'reveal-sync-ping',
          optionKey: 'presentationUrl',
          timeoutMs: 4000.9,
        },
      },
      createSessionBootstrap: {
        sessionStorage: [
          {
            keyPrefix: 'syncdeck_instructor_',
            responseField: 'instructorPasscode',
          },
        ],
      },
    },
    'test-config',
  )

  assert.equal(parsed.id, 'syncdeck')
  assert.equal(parsed.deepLinkGenerator?.preflight?.timeoutMs, 4000)
  assert.deepEqual(parsed.createSessionBootstrap?.sessionStorage?.[0], {
    keyPrefix: 'syncdeck_instructor_',
    responseField: 'instructorPasscode',
  })
})

void test('parseActivityConfig rejects invalid shared contract enums and shapes', () => {
  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad',
          name: 'Bad',
          description: 'desc',
          color: 'red',
          soloMode: false,
          deepLinkGenerator: {
            endpoint: '/api/example',
            mode: 'invalid-mode',
          },
        },
        'bad-config',
      ),
    /deepLinkGenerator.*mode/,
  )

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad2',
          name: 'Bad2',
          description: 'desc',
          color: 'blue',
          soloMode: true,
          createSessionBootstrap: {
            sessionStorage: [{ keyPrefix: 'x_' }],
          },
        },
        'bad-config-2',
      ),
    /responseField/,
  )
})

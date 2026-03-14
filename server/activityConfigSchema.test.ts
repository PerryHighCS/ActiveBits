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
      standaloneEntry: {
        enabled: false,
        supportsDirectPath: false,
        supportsPermalink: false,
        showOnHome: false,
      },
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
      waitingRoom: {
        fields: [
          {
            id: 'displayName',
            type: 'text',
            label: 'Display name',
            required: true,
            placeholder: 'Enter your name',
          },
          {
            id: 'team',
            type: 'select',
            options: [
              { value: 'red', label: 'Red Team' },
              { value: 'blue', label: 'Blue Team' },
            ],
          },
          {
            id: 'chooser',
            type: 'custom',
            component: 'ChooserField',
            props: {
              prompt: 'Pick your path',
              allowSkip: false,
            },
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
  assert.equal(parsed.waitingRoom?.fields[0]?.type, 'text')
  assert.equal(parsed.waitingRoom?.fields[2]?.type, 'custom')
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
          standaloneEntry: {
            enabled: false,
            supportsDirectPath: false,
            supportsPermalink: false,
            showOnHome: false,
          },
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
          standaloneEntry: {
            enabled: true,
            supportsDirectPath: true,
            supportsPermalink: true,
            showOnHome: true,
          },
          createSessionBootstrap: {
            sessionStorage: [{ keyPrefix: 'x_' }],
          },
        },
        'bad-config-2',
      ),
    /responseField/,
  )

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad3',
          name: 'Bad3',
          description: 'desc',
          color: 'orange',
          standaloneEntry: {
            enabled: true,
            supportsDirectPath: true,
            supportsPermalink: true,
            showOnHome: true,
          },
          waitingRoom: {
            fields: [
              {
                id: 'chooser',
                type: 'custom',
                component: 'ChooserField',
                props: {
                  onPick: () => 'not-serializable',
                },
              },
            ],
          },
        },
        'bad-config-3',
      ),
    /props.*serializable object/,
  )
})

void test('parseActivityConfig removes optional keys when input provides null', () => {
  const parsed = parseActivityConfig(
    {
      id: 'nullables',
      name: 'Nullables',
      description: 'desc',
      color: 'green',
      standaloneEntry: {
        enabled: false,
        supportsDirectPath: false,
        supportsPermalink: false,
        showOnHome: false,
      },
      title: null,
      deepLinkOptions: null,
    },
    'null-config',
  )

  assert.equal(parsed.title, undefined)
  assert.equal(parsed.deepLinkOptions, undefined)
  assert.equal('title' in parsed, false)
  assert.equal('deepLinkOptions' in parsed, false)
})

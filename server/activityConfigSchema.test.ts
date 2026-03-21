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
      utilities: [
        {
          id: 'gallery-walk-review-copy',
          label: 'Copy Gallery Walk Review Link',
          action: 'copy-url',
          path: '/util/gallery-walk/viewer',
          description: 'Upload and review feedback that was left for you.',
          surfaces: ['manage'],
          standaloneSessionId: 'solo-gallery-walk',
        },
        {
          id: 'gallery-walk-review-home',
          label: 'Gallery Walk Review',
          action: 'go-to-url',
          path: '/util/gallery-walk/viewer',
          surfaces: ['home'],
        },
      ],
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
        historyState: ['instructorPasscode'],
        sessionStorage: [
          {
            keyPrefix: 'syncdeck_instructor_',
            responseField: 'instructorPasscode',
          },
        ],
      },
      manageDashboard: {
        customPersistentLinkBuilder: true,
        persistentLinkBuilderMode: 'shared-submit',
      },
      embeddedRuntime: {
        instructorGated: 'runtime',
      },
      reportEndpoint: '/api/syncdeck/s1/report',
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
  assert.deepEqual(parsed.createSessionBootstrap?.historyState, ['instructorPasscode'])
  assert.equal(parsed.manageDashboard?.persistentLinkBuilderMode, 'shared-submit')
  assert.equal(parsed.embeddedRuntime?.instructorGated, 'runtime')
  assert.equal(parsed.reportEndpoint, '/api/syncdeck/s1/report')
  assert.deepEqual(parsed.utilities, [
    {
      id: 'gallery-walk-review-copy',
      label: 'Copy Gallery Walk Review Link',
      action: 'copy-url',
      path: '/util/gallery-walk/viewer',
      description: 'Upload and review feedback that was left for you.',
      surfaces: ['manage'],
      standaloneSessionId: 'solo-gallery-walk',
    },
    {
      id: 'gallery-walk-review-home',
      label: 'Gallery Walk Review',
      action: 'go-to-url',
      path: '/util/gallery-walk/viewer',
      surfaces: ['home'],
    },
  ])
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

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad4',
          name: 'Bad4',
          description: 'desc',
          color: 'purple',
          standaloneEntry: {
            enabled: false,
            supportsDirectPath: false,
            supportsPermalink: false,
            showOnHome: false,
          },
          utilities: [
            {
              id: 'utility',
              label: 'Broken Utility',
              action: 'download-url',
              path: '/util/broken',
            },
          ],
        },
        'bad-config-4',
      ),
    /utilities\[0\].*action/,
  )

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad6',
          name: 'Bad6',
          description: 'desc',
          color: 'teal',
          standaloneEntry: {
            enabled: false,
            supportsDirectPath: false,
            supportsPermalink: false,
            showOnHome: false,
          },
          manageDashboard: {
            customPersistentLinkBuilder: true,
            persistentLinkBuilderMode: 'builder-only',
          },
        },
        'bad-config-6',
      ),
    /persistentLinkBuilderMode/,
  )

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad5',
          name: 'Bad5',
          description: 'desc',
          color: 'teal',
          standaloneEntry: {
            enabled: false,
            supportsDirectPath: false,
            supportsPermalink: false,
            showOnHome: false,
          },
          utilities: [
            {
              id: 'utility',
              label: 'Broken Utility',
              action: 'copy-url',
              path: '/util/broken',
              surfaces: ['manage', 'dashboard'],
            },
          ],
        },
        'bad-config-5',
      ),
    /utilities\[0\].*surfaces/,
  )

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad6',
          name: 'Bad6',
          description: 'desc',
          color: 'blue',
          standaloneEntry: {
            enabled: true,
            supportsDirectPath: true,
            supportsPermalink: true,
            showOnHome: true,
          },
          createSessionBootstrap: {
            historyState: ['ok', ''],
          },
        },
        'bad-config-6',
      ),
    /historyState/,
  )

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad7',
          name: 'Bad7',
          description: 'desc',
          color: 'navy',
          standaloneEntry: {
            enabled: true,
            supportsDirectPath: true,
            supportsPermalink: true,
            showOnHome: true,
          },
          embeddedRuntime: {
            instructorGated: true,
          },
        },
        'bad-config-7',
      ),
    /embeddedRuntime.*instructorGated.*runtime.*waiting-room/,
  )

  assert.throws(
    () =>
      parseActivityConfig(
        {
          id: 'bad8',
          name: 'Bad8',
          description: 'desc',
          color: 'gray',
          standaloneEntry: {
            enabled: true,
            supportsDirectPath: true,
            supportsPermalink: true,
            showOnHome: true,
          },
          reportEndpoint: 42,
        },
        'bad-config-8',
      ),
    /reportEndpoint.*non-empty string/,
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
      reportEndpoint: null,
    },
    'null-config',
  )

  assert.equal(parsed.title, undefined)
  assert.equal(parsed.deepLinkOptions, undefined)
  assert.equal(parsed.reportEndpoint, undefined)
  assert.equal('title' in parsed, false)
  assert.equal('deepLinkOptions' in parsed, false)
  assert.equal('reportEndpoint' in parsed, false)
})

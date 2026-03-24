import type { ActivityConfig } from '../../types/activity.js'

const syncdeckConfig: ActivityConfig = {
  id: 'syncdeck',
  name: 'SyncDeck',
  description: 'Host a synchronized presentation for your class',
  color: 'indigo',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: false,
    supportsPermalink: true,
    showOnHome: false,
    title: 'SyncDeck Standalone',
    description: 'Launch a hosted standalone presentation session from a permalink.',
  },
  waitingRoom: {
    fields: [
      {
        id: 'displayName',
        label: 'Display Name',
        type: 'text',
        required: true,
        placeholder: 'Your name',
      },
    ],
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
    preflight: {
      type: 'reveal-sync-ping',
      optionKey: 'presentationUrl',
    },
  },
  utilities: [
    {
      id: 'launch-presentation',
      label: 'Launch Presentation',
      action: 'go-to-url',
      path: '/util/syncdeck/launch-presentation',
      description: 'Validate a public presentation URL and start a standalone SyncDeck session.',
      renderTarget: 'util',
    },
  ],
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'syncdeck_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
  },
  manageDashboard: {
    customPersistentLinkBuilder: true,
  },
  manageLayout: {
    expandShell: true,
  },
  utilMode: true,
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default syncdeckConfig

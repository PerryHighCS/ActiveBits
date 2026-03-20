import type { ActivityConfig } from '../../types/activity.js'

const resonanceConfig: ActivityConfig = {
  id: 'resonance',
  name: 'Resonance',
  description: 'Collect, review, and share class responses in real time',
  color: 'rose',
  standaloneEntry: {
    enabled: false,
    supportsDirectPath: false,
    supportsPermalink: false,
    showOnHome: false,
  },
  deepLinkOptions: {
    // q: encrypted question set; h: persistent hash used for decryption
    // Both are internal and managed by the custom link builder — not shown in generic UI.
    q: {},
    h: {},
  },
  deepLinkGenerator: {
    endpoint: '/api/resonance/generate-link',
    mode: 'replace-url',
    expectsSelectedOptions: false,
  },
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'resonance_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
  },
  utilities: [
    {
      id: 'resonance-tools',
      label: 'Resonance Tools',
      action: 'go-to-url' as const,
      path: '/util/resonance',
      description: 'Build question sets, import/export, and review session reports.',
      surfaces: ['manage' as const],
    },
  ],
  manageDashboard: {
    customPersistentLinkBuilder: true,
  },
  reportEndpoint: '/api/resonance/:sessionId/report',
  waitingRoom: {
    fields: [
      {
        id: 'displayName',
        label: 'Your name',
        type: 'text' as const,
        required: true,
        placeholder: 'Enter your display name',
      },
    ],
  },
  isDev: true,
  utilMode: true,
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default resonanceConfig

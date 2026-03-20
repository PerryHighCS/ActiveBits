import type { ActivityConfig } from '../../types/activity.js'

const resonanceConfig: ActivityConfig = {
  id: 'resonance',
  name: 'Resonance',
  description: 'Collect, review, and share class responses in real time',
  color: 'rose',
  soloMode: false,
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
  manageDashboard: {
    customPersistentLinkBuilder: true,
  },
  isDev: true,
  utilMode: true,
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default resonanceConfig

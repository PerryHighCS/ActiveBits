import type { ActivityConfig } from '../../types/activity.js'

const syncdeckConfig: ActivityConfig = {
  id: 'syncdeck',
  name: 'SyncDeck',
  description: 'Host a synchronized Reveal.js presentation for your class',
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
  },
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default syncdeckConfig

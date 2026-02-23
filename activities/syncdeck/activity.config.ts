import type { ActivityConfig } from '../../types/activity.js'

const syncdeckConfig: ActivityConfig = {
  id: 'syncdeck',
  name: 'SyncDeck',
  description: 'Host a synchronized Reveal.js presentation for your class',
  color: 'indigo',
  soloMode: false,
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default syncdeckConfig

import type { ActivityConfig } from '../../types/activity.js'

const wwwSimConfig: ActivityConfig = {
  id: 'www-sim',
  name: 'WWW Simulation',
  description: 'Simulate IP-based discovery and HTTP interactions',
  color: 'yellow',
  soloMode: false,
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default wwwSimConfig

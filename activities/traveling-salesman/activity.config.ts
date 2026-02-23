import type { ActivityConfig } from '../../types/activity.js'

const travelingSalesmanConfig: ActivityConfig = {
  id: 'traveling-salesman',
  name: 'Traveling Salesman',
  description: 'Explore optimal routes: compete against brute force and heuristic algorithms',
  color: 'orange',
  soloMode: true,
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default travelingSalesmanConfig

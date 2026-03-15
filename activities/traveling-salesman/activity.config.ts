import type { ActivityConfig } from '../../types/activity.js'

const travelingSalesmanConfig: ActivityConfig = {
  id: 'traveling-salesman',
  name: 'Traveling Salesman',
  description: 'Explore optimal routes: compete against brute force and heuristic algorithms',
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
        id: 'displayName',
        label: 'Display Name',
        type: 'text',
        required: true,
        placeholder: 'Your name',
      },
    ],
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default travelingSalesmanConfig

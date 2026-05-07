import type { ActivityConfig } from '../../types/activity.js'

const binaryBreachConfig: ActivityConfig = {
  id: 'binary-breach',
  name: 'Binary Breach',
  description: 'Restore locked systems by solving binary and decimal challenges',
  color: 'cyan',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: true,
    supportsPermalink: true,
    showOnHome: true,
    title: 'Binary Breach: System Override',
    description: 'Practice binary conversion, comparison, and ordering through system recovery missions',
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

export default binaryBreachConfig


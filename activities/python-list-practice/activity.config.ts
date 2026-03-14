import type { ActivityConfig } from '../../types/activity.js'

const pythonListPracticeConfig: ActivityConfig = {
  id: 'python-list-practice',
  name: 'Python List Practice',
  description: 'Practice Python list operations with words and numbers',
  color: 'green',
  soloMode: true,
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

export default pythonListPracticeConfig

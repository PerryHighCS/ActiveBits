import type { ActivityConfig } from '../../types/activity.js'

const pythonListPracticeConfig: ActivityConfig = {
  id: 'python-list-practice',
  name: 'Python List Practice',
  description: 'Practice Python list operations with words and numbers',
  color: 'green',
  soloMode: true,
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default pythonListPracticeConfig

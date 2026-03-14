import type { ActivityConfig } from '../../types/activity.js'

const javaStringPracticeConfig: ActivityConfig = {
  id: 'java-string-practice',
  name: 'Java String Practice',
  description: 'Interactive practice for Java String methods',
  color: 'purple',
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

export default javaStringPracticeConfig

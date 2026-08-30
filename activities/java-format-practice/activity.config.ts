import type { ActivityConfig } from '../../types/activity.js'

const javaFormatPracticeConfig: ActivityConfig = {
  id: 'java-format-practice',
  name: 'Java Format Practice',
  description: 'Interactive practice for Java printf and String.format',
  color: 'emerald',
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

export default javaFormatPracticeConfig

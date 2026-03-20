import type { ActivityConfig } from '../../types/activity.js'

const embeddedTestConfig: ActivityConfig = {
  id: 'embedded-test',
  name: 'Embedded Test',
  description: 'Dev-only embedded contract harness for manager/student overlay testing',
  color: 'amber',
  isDev: true,
  standaloneEntry: {
    enabled: false,
    supportsDirectPath: false,
    supportsPermalink: false,
    showOnHome: false,
  },
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default embeddedTestConfig
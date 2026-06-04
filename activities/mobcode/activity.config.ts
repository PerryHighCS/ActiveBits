import type { ActivityConfig } from '../../types/activity.js'

const mobCodeConfig: ActivityConfig = {
  id: 'mobcode',
  name: 'Mob Code',
  description: 'Share a live multi-file code editor with students in real time',
  color: 'blue',
  standaloneEntry: {
    enabled: false,
    supportsDirectPath: false,
    supportsPermalink: false,
    showOnHome: false,
  },
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'mobcode_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
    historyState: ['instructorPasscode'],
  },
  studentLayout: {
    expandShell: true,
  },
  manageLayout: {
    expandShell: true,
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default mobCodeConfig

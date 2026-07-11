import type { ActivityConfig } from '../../types/activity.js'

const postboardConfig: ActivityConfig = {
  id: 'postboard',
  name: 'Postboard',
  description: 'Collect and moderate student notes on a shared board',
  color: 'teal',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: false,
    supportsPermalink: true,
    showOnHome: false,
  },
  deepLinkOptions: {
    prompt: {
      label: 'Prompt',
      type: 'text',
    },
    autoApprove: {
      label: 'Auto-approve student notes',
      type: 'checkbox',
      defaultValue: false,
    },
  },
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'postboard_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
    historyState: ['instructorPasscode'],
    selectedOptionsToSessionData: ['prompt', 'autoApprove'],
  },
  waitingRoom: {
    fields: [
      {
        id: 'displayName',
        label: 'Your name',
        type: 'text',
        required: true,
        placeholder: 'Enter your display name',
      },
    ],
  },
  manageLayout: {
    expandShell: true,
  },
  studentLayout: {
    expandShell: true,
  },
  reportEndpoint: '/api/postboard/:sessionId/report',
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default postboardConfig

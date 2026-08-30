import type { ActivityConfig } from '../../types/activity.js'

const javaFormatPracticeConfig: ActivityConfig = {
  id: 'java-format-practice',
  name: 'Java Format Practice',
  description: 'Interactive practice for Java printf and String.format',
  color: 'emerald',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: true,
    // Interim stopgap for the shared-activity-runtime migration (Slice A): the
    // permalink / persistent-teacher entry path creates sessions outside
    // `POST /api/java-format-practice/create`, so it never receives a manager
    // capability cookie and every gated manager route/socket would 403 / close
    // 1008. Re-enable once the Slice C persistent-teacher -> manager-principal
    // adapter issues the capability. Tracked in
    // https://github.com/PerryHighCS/ActiveBits/issues/351
    supportsPermalink: false,
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

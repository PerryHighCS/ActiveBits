import type { ActivityConfig } from '../../types/activity.js'

const commissionedIdeasConfig: ActivityConfig = {
  id: 'commissioned-ideas',
  name: 'Commissioned Ideas',
  description: 'Teams pitch their ideas and the class votes to award funding',
  color: 'amber',
  standaloneEntry: {
    enabled: false,
    supportsDirectPath: false,
    supportsPermalink: false,
    showOnHome: false,
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default commissionedIdeasConfig

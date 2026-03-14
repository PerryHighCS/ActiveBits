import type { ActivityConfig } from '../../types/activity.js'

const galleryWalkConfig: ActivityConfig = {
  id: 'gallery-walk',
  name: 'Gallery Walk',
  description: 'Participants showcase projects and leave peer feedback',
  color: 'blue',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: true,
    supportsPermalink: false,
    showOnHome: false,
    title: 'Review Gallery Walk Feedback',
    description: 'Upload and review feedback that was left for you.',
  },
  manageDashboard: {
    utilities: [
      {
        label: 'Gallery Walk Review',
        path: '/util/gallery-walk/viewer',
        description: 'Upload and review feedback that was left for you.',
        showOnHome: true,
        standaloneSessionId: 'solo-gallery-walk',
      },
    ],
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default galleryWalkConfig

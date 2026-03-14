import type { ActivityConfig } from '../../types/activity.js'

const galleryWalkConfig: ActivityConfig = {
  id: 'gallery-walk',
  name: 'Gallery Walk',
  description: 'Participants showcase projects and leave peer feedback',
  color: 'blue',
  soloMode: true,
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: true,
    supportsPermalink: false,
    showOnHome: false,
    title: 'Review Gallery Walk Feedback',
    description: 'Upload and review feedback that was left for you.',
  },
  soloModeMeta: {
    title: 'Review Gallery Walk Feedback',
    description: 'Upload and review feedback that was left for you.',
  },
  manageDashboard: {
    utilities: [
      {
        label: 'Copy Feedback Review Link',
        path: '/solo/gallery-walk',
        description: 'Upload and review feedback that was left for you.',
        showOnHome: true,
      },
    ],
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default galleryWalkConfig

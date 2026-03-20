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
  utilities: [
    {
      id: 'gallery-walk-review-copy',
      label: 'Copy Gallery Walk Review Link',
      action: 'copy-url',
      path: '/util/gallery-walk/viewer',
      description: 'Upload and review feedback that was left for you.',
      surfaces: ['manage'],
      standaloneSessionId: 'solo-gallery-walk',
    },
    {
      id: 'gallery-walk-review-home',
      label: 'Gallery Walk Review',
      action: 'go-to-url',
      path: '/util/gallery-walk/viewer',
      description: 'Upload and review feedback that was left for you.',
      surfaces: ['home'],
      standaloneSessionId: 'solo-gallery-walk',
    },
  ],
  reportEndpoint: '/api/gallery-walk/:sessionId/report',
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default galleryWalkConfig

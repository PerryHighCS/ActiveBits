import type { ActivityConfig } from '../../types/activity.js'

const galleryWalkConfig: ActivityConfig = {
  id: 'gallery-walk',
  name: 'Gallery Walk',
  description: 'Participants showcase projects and leave peer feedback',
  color: 'blue',
  soloMode: true,
  soloModeMeta: {
    title: 'Review Gallery Walk Feedback',
    description: 'Upload and review feedback that was left for you.',
    buttonText: 'Copy Feedback Review Link',
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default galleryWalkConfig

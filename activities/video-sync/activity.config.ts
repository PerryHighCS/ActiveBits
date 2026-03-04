import type { ActivityConfig } from '../../types/activity.js'

const videoSyncConfig: ActivityConfig = {
  id: 'video-sync',
  name: 'Video Sync',
  description: 'Synchronized YouTube playback for whole-class instruction',
  color: 'rose',
  soloMode: false,
  deepLinkOptions: {
    sourceUrl: {
      label: 'YouTube URL',
      type: 'text',
      validator: 'url',
    },
  },
  createSessionBootstrap: {
    historyState: ['instructorPasscode'],
  },
  manageLayout: {
    expandShell: true,
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default videoSyncConfig

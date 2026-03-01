import type { ActivityConfig } from '../../types/activity.js'

const videoSyncConfig: ActivityConfig = {
  id: 'video-sync',
  name: 'Video Sync',
  description: 'Synchronized YouTube playback for whole-class instruction',
  color: 'rose',
  soloMode: true,
  soloModeMeta: {
    title: 'Video Sync Solo Practice',
    description: 'Practice with YouTube videos independently at your own pace',
    buttonText: 'Copy Video Sync Solo Link',
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default videoSyncConfig

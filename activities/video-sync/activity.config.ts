import type { ActivityConfig } from '../../types/activity.js'

const videoSyncConfig: ActivityConfig = {
  id: 'video-sync',
  name: 'Video Sync',
  description: 'Synchronized YouTube playback for whole-class instruction',
  color: 'rose',
  soloMode: false,
  manageLayout: {
    expandShell: true,
  },
  createSessionBootstrap: {
    sessionStorage: [
      {
        keyPrefix: 'video_sync_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}

export default videoSyncConfig

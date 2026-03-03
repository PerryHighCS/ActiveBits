import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import VideoSyncManager from './manager/VideoSyncManager.js'
import VideoSyncStudent from './student/VideoSyncStudent.js'

const videoSyncActivity: ActivityClientModule = {
  ManagerComponent: VideoSyncManager as ComponentType<unknown>,
  StudentComponent: VideoSyncStudent as ComponentType<unknown>,
  footerContent: null,
}

export default videoSyncActivity

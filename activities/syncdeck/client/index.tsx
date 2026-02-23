import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import SyncDeckManager from './manager/SyncDeckManager.js'
import SyncDeckStudent from './student/SyncDeckStudent.js'

const syncdeckActivity: ActivityClientModule = {
  ManagerComponent: SyncDeckManager as ComponentType<unknown>,
  StudentComponent: SyncDeckStudent as ComponentType<unknown>,
  footerContent: null,
}

export default syncdeckActivity

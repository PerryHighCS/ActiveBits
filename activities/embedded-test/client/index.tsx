import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import EmbeddedTestManager from './manager/EmbeddedTestManager.js'
import EmbeddedTestStudent from './student/EmbeddedTestStudent.js'

const embeddedTestActivity: ActivityClientModule = {
  ManagerComponent: EmbeddedTestManager as ComponentType<unknown>,
  StudentComponent: EmbeddedTestStudent as ComponentType<unknown>,
  footerContent: null,
}

export default embeddedTestActivity
import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import DemoManager from './manager/DemoManager.js'
import DemoStudent from './student/DemoStudent.js'

const algorithmDemoActivity: ActivityClientModule = {
  ManagerComponent: DemoManager as ComponentType<unknown>,
  StudentComponent: DemoStudent as ComponentType<unknown>,
  footerContent: null,
}

export default algorithmDemoActivity

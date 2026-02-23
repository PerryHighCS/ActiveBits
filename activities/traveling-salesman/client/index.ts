import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import TSPManager from './manager/TSPManager'
import TSPStudent from './student/TSPStudent'

const travelingSalesmanActivity: ActivityClientModule = {
  ManagerComponent: TSPManager as ComponentType<unknown>,
  StudentComponent: TSPStudent as ComponentType<unknown>,
  footerContent: null,
}

export default travelingSalesmanActivity

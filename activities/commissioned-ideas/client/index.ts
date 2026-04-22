import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import CommissionedIdeasManager from './manager/CommissionedIdeasManager'
import CommissionedIdeasStudent from './student/CommissionedIdeasStudent'

const commissionedIdeasActivity: ActivityClientModule = {
  ManagerComponent: CommissionedIdeasManager as ComponentType<unknown>,
  StudentComponent: CommissionedIdeasStudent as ComponentType<unknown>,
  footerContent: null,
}

export default commissionedIdeasActivity

import type { ComponentType } from 'react'
import type { ActivityClientModule, ActivityPersistentLinkBuilderProps } from '../../../types/activity.js'
import ResonanceManager from './manager/ResonanceManager.js'
import ResonanceStudent from './student/ResonanceStudent.js'
import ResonancePersistentLinkBuilder from './tools/ResonancePersistentLinkBuilder.js'
import ResonanceToolShell from './tools/ResonanceToolShell.js'

const resonanceActivity: ActivityClientModule = {
  ManagerComponent: ResonanceManager as ComponentType<unknown>,
  StudentComponent: ResonanceStudent as ComponentType<unknown>,
  UtilComponent: ResonanceToolShell as ComponentType<unknown>,
  PersistentLinkBuilderComponent: ResonancePersistentLinkBuilder as ComponentType<ActivityPersistentLinkBuilderProps>,
  footerContent: null,
}

export default resonanceActivity

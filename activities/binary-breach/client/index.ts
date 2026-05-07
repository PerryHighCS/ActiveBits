import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import BinaryBreachManager from './manager/BinaryBreachManager'
import BinaryBreachStudent from './student/BinaryBreachStudent'
import './styles.css'

const binaryBreachActivity: ActivityClientModule = {
  ManagerComponent: BinaryBreachManager as ComponentType<unknown>,
  StudentComponent: BinaryBreachStudent as ComponentType<unknown>,
  footerContent: null,
}

export default binaryBreachActivity


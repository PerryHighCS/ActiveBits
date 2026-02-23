import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import JavaStringPracticeManager from './manager/JavaStringPracticeManager'
import JavaStringPractice from './student/JavaStringPractice'

const javaStringPracticeActivity: ActivityClientModule = {
  ManagerComponent: JavaStringPracticeManager as ComponentType<unknown>,
  StudentComponent: JavaStringPractice as ComponentType<unknown>,
  footerContent: null,
}

export default javaStringPracticeActivity

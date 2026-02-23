import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import JavaFormatPracticeManager from './manager/JavaFormatPracticeManager'
import JavaFormatPractice from './student/JavaFormatPractice'

const javaFormatPracticeActivity: ActivityClientModule = {
  ManagerComponent: JavaFormatPracticeManager as ComponentType<unknown>,
  StudentComponent: JavaFormatPractice as ComponentType<unknown>,
  footerContent: null,
}

export default javaFormatPracticeActivity

import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import PythonListPracticeManager from './manager/PythonListPracticeManager'
import PythonListPractice from './student/PythonListPractice'

const pythonListPracticeActivity: ActivityClientModule = {
  ManagerComponent: PythonListPracticeManager as ComponentType<unknown>,
  StudentComponent: PythonListPractice as ComponentType<unknown>,
  footerContent: null,
}

export default pythonListPracticeActivity

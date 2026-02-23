import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import ManagerPage from './manager/ManagerPage'
import StudentPage from './student/StudentPage'
import './galleryWalk.css'

const galleryWalkActivity: ActivityClientModule = {
  ManagerComponent: ManagerPage as ComponentType<unknown>,
  StudentComponent: StudentPage as ComponentType<unknown>,
  footerContent: null,
}

export default galleryWalkActivity

import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import PostboardManager from './manager/PostboardManager'
import PostboardStudent from './student/PostboardStudent'
import '../../shared/client/noteStyles.css'
import './styles.css'

const postboardActivity: ActivityClientModule = {
  ManagerComponent: PostboardManager as ComponentType<unknown>,
  StudentComponent: PostboardStudent as ComponentType<unknown>,
  footerContent: null,
}

export default postboardActivity

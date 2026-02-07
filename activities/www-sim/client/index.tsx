import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import WwwSimManager from './manager/WwwSimManager'
import WwwSim from './student/WwwSim'

const wwwSimActivity: ActivityClientModule = {
  ManagerComponent: WwwSimManager as ComponentType<unknown>,
  StudentComponent: WwwSim as ComponentType<unknown>,
  footerContent: (
    <>
      Portions of this activity are adapted from{' '}
      <a
        href="https://code.org"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-700"
      >
        Code.org
      </a>{' '}
      Computer Science Principles curriculum. Used under{' '}
      <a
        href="https://code.org/en-US/terms-of-service"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-700"
      >
        CC BY-NC-SA 4.0
      </a>
      .
    </>
  ),
}

export default wwwSimActivity

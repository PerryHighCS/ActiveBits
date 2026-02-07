import type { ComponentType } from 'react'
import type { ActivityClientModule } from '../../../types/activity.js'
import RaffleManager from './manager/RaffleManager'
import TicketPage from './student/TicketPage'

const raffleActivity: ActivityClientModule = {
  ManagerComponent: RaffleManager as ComponentType<unknown>,
  StudentComponent: TicketPage as ComponentType<unknown>,
  footerContent: (
    <>
      Note: Raffles are for educational demonstration purposes only. Raffles are automatically deleted after 24 hours.
      <br />
      <br />
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

export default raffleActivity

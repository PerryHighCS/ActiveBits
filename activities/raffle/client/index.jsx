/**
 * Raffle Activity Configuration
 * 
 * This file exports the configuration for the raffle activity,
 * making it easy to register the activity in the main app.
 */

import React from 'react';
import RaffleManager from './manager/RaffleManager';
import TicketPage from './student/TicketPage';

export const raffleActivity = {
  // Manager component (teacher view)
  ManagerComponent: RaffleManager,
  
  // Student component (student view)
  StudentComponent: TicketPage,
  
  // Footer content specific to this activity (optional)
  footerContent: (
    <>
      Note: Raffles are for educational demonstration purposes only. Raffles are automatically deleted after 24 hours.
      <br /><br />
      Portions of this activity are adapted from{" "}
      <a
        href="https://code.org"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-700"
      >
        Code.org
      </a>{" "}
      Computer Science Principles curriculum. Used under{" "}
      <a
        href="https://code.org/en-US/terms-of-service"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-700"
      >
        CC BY-NC-SA 4.0
      </a>.
    </>
  ),
};

export default raffleActivity;

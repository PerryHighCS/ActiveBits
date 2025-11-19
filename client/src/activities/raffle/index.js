/**
 * Raffle Activity Configuration
 * 
 * This file exports the configuration for the raffle activity,
 * making it easy to register the activity in the main app.
 */

import RaffleManager from './manager/RaffleManager';
import TicketPage from './student/TicketPage';

export const raffleActivity = {
  // Unique identifier for this activity type
  id: 'raffle',
  
  // Display name for the activity
  name: 'Raffle',
  
  // Description shown in the dashboard
  description: 'Students scan a QR code to receive a unique ticket',
  
  // Manager component (teacher view)
  ManagerComponent: RaffleManager,
  
  // Student component (student view)
  StudentComponent: TicketPage,
  
  // Footer content specific to this activity (optional)
  footerContent: 'Note: Raffles are for educational demonstration purposes only. Raffles are automatically deleted after 24 hours.',
  
  // Button styling for the dashboard
  buttonColor: 'blue',
  
  // Whether this activity can be used in solo mode (without a teacher session)
  soloMode: false,
};

export default raffleActivity;

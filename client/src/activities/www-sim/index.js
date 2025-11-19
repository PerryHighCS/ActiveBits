/**
 * WWW Simulation Activity Configuration
 * 
 * This file exports the configuration for the www-sim activity,
 * making it easy to register the activity in the main app.
 */

import WwwSimManager from './manager/WwwSimManager';
import WwwSim from './student/WwwSim';

export const wwwSimActivity = {
  // Unique identifier for this activity type
  id: 'www-sim',
  
  // Display name for the activity
  name: 'WWW Simulation',
  
  // Description shown in the dashboard
  description: 'Simulate IP-based discovery and HTTP interactions',
  
  // Manager component (teacher view)
  ManagerComponent: WwwSimManager,
  
  // Student component (student view)
  StudentComponent: WwwSim,
  
  // Footer content specific to this activity (optional)
  footerContent: null,
  
  // Button styling for the dashboard
  buttonColor: 'green',
};

export default wwwSimActivity;

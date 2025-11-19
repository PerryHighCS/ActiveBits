/**
 * WWW Simulation Activity Configuration
 * 
 * This file exports the configuration for the www-sim activity,
 * making it easy to register the activity in the main app.
 */

import React from 'react';
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
  footerContent: (
    <>
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
  
  // Button styling for the dashboard
  buttonColor: 'green',
  
  // Whether this activity can be used in solo mode (without a teacher session)
  soloMode: false,
};

export default wwwSimActivity;

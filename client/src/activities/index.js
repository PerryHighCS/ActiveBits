/**
 * Activity Registry
 * 
 * This file centralizes all activity configurations, making it easy to:
 * - Add new activities
 * - Manage activity metadata
 * - Generate routes automatically
 * 
 * To add a new activity:
 * 1. Create a new folder in /activities with manager/ and student/ subdirectories
 * 2. Create an index.js file exporting the activity configuration
 * 3. Import and add it to the activities array below
 */

import raffleActivity from './raffle';
import wwwSimActivity from './www-sim';

// Array of all registered activities
export const activities = [
  raffleActivity,
  wwwSimActivity,
];

// Create a map for quick lookup by activity ID
export const activityMap = activities.reduce((map, activity) => {
  map[activity.id] = activity;
  return map;
}, {});

// Helper to get activity by ID
export const getActivity = (id) => activityMap[id];

export default activities;
